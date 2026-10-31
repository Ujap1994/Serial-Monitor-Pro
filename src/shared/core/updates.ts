// Update notice: which published releases are newer than the running version
// and what changed in them.

import type { ReleaseInfo } from '../ipc';

/** [major, minor, patch] of "1.2.3" or "v1.2.3"; null for anything else. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(text.trim());
  if (!m) return null;
  const version: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return version.every(Number.isSafeInteger) ? version : null;
}

/** Negative if a < b, positive if a > b, 0 if equal. Unreadable versions count as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Validates the answer of the GitHub releases API; entries without a version tag are dropped. */
export function parseReleases(raw: unknown): ReleaseInfo[] {
  if (!Array.isArray(raw)) throw new Error('Unexpected answer from GitHub');
  return raw.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const d = entry as Record<string, unknown>;
    const tag = text(d.tag_name);
    if (!parseVersion(tag)) return [];
    return [
      {
        tag,
        name: text(d.name) || tag,
        url: text(d.html_url),
        date: text(d.published_at),
        body: text(d.body),
        draft: d.draft === true,
        prerelease: d.prerelease === true,
      },
    ];
  });
}

/** Published releases newer than `current`, newest first – drafts and pre-releases are ignored. */
export function newerReleases(releases: readonly ReleaseInfo[], current: string): ReleaseInfo[] {
  const seen = new Set<string>();
  return releases
    .filter((r) => {
      const version = parseVersion(r.tag)?.join('.');
      if (
        !version ||
        r.draft ||
        r.prerelease ||
        compareVersions(r.tag, current) <= 0 ||
        seen.has(version)
      )
        return false;
      seen.add(version);
      return true;
    })
    .sort((a, b) => compareVersions(b.tag, a.tag));
}

/**
 * The "Changes" part of the release notes. The notes also contain a download
 * table, which is of no use inside the application.
 */
export function releaseChanges(body: string): string {
  const notes = body.replace(/\r\n/g, '\n');
  const match = /^## Changes[ \t]*$/m.exec(notes);
  return (match ? notes.slice(match.index + match[0].length) : notes).trim();
}
