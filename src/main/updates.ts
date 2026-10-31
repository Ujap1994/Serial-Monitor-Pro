import { newerReleases, parseReleases } from '@shared/core/updates';
import type { ReleaseInfo } from '@shared/ipc';
import { RELEASES_API } from './constants';

type FetchReleases = (
  url: string,
  options: {
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

/** A single deadline covers the complete feed, including every response body. */
export async function fetchNewerReleases(
  fetch: FetchReleases,
  current: string,
  timeoutMs = 10_000,
): Promise<ReleaseInfo[]> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Update check timed out')),
    timeoutMs,
  );
  timeout.unref();
  const visited = new Set<string>();
  const releases: ReleaseInfo[] = [];
  const endpoint = new URL(RELEASES_API);
  let next: string | undefined = RELEASES_API;
  try {
    while (next) {
      const url = new URL(next);
      if (
        url.origin !== endpoint.origin ||
        url.pathname !== endpoint.pathname ||
        visited.has(url.href)
      ) {
        throw new Error('Invalid GitHub release pagination');
      }
      visited.add(url.href);
      controller.signal.throwIfAborted();
      const response = await fetch(url.href, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
      releases.push(...parseReleases(await response.json()));
      controller.signal.throwIfAborted();
      const links = response.headers.get('link') ?? '';
      next = links.split(',').flatMap((link) => {
        const target = /^\s*<([^>]+)>/.exec(link)?.[1];
        const relation = /;\s*rel\s*=\s*"([^"]+)"/.exec(link)?.[1];
        return target && relation?.split(/\s+/).includes('next') ? [target] : [];
      })[0];
    }
    // GitHub orders by creation date, not semver. An older tag on one page
    // cannot prove that later pages contain no newer versions.
    return newerReleases(releases, current);
  } finally {
    clearTimeout(timeout);
  }
}
