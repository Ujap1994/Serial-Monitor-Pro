import { afterEach, describe, expect, it, vi } from 'vitest';
import { RELEASES_API } from '../../src/main/constants';
import { fetchNewerReleases } from '../../src/main/updates';

const page = (entries: unknown, link = '', status = 200): Response =>
  new Response(JSON.stringify(entries), {
    status,
    headers: { 'content-type': 'application/json', link },
  });
const entry = (version: string, extra: Record<string, unknown> = {}) => ({
  tag_name: `v${version}`,
  body: `Changes in ${version}`,
  ...extra,
});
const nextPage = (number: number): string => `${RELEASES_API}&page=${number}`;
afterEach(() => vi.useRealTimers());

describe('fetchNewerReleases', () => {
  it('collects cumulative notes beyond the first page, regardless of creation order', async () => {
    const first = Array.from({ length: 100 }, (_, i) => entry(`1.0.${i + 3}`));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        page(first, `<${nextPage(2)}>; rel="next", <${nextPage(3)}>; rel="last"`),
      )
      .mockResolvedValueOnce(
        page(
          [
            entry('0.9.0'),
            entry('1.0.1'),
            entry('1.0.2'),
            entry('2.0.0', { draft: true }),
            entry('3.0.0', { prerelease: true }),
          ],
          `<${RELEASES_API}>; rel="prev", <${nextPage(3)}>; rel="next"`,
        ),
      )
      .mockResolvedValueOnce(page([entry('1.1.0'), entry('1.0.50')]));
    const result = await fetchNewerReleases(fetch, '1.0.2');
    expect(result).toHaveLength(101);
    expect(result[0]).toMatchObject({ tag: 'v1.1.0', body: 'Changes in 1.1.0' });
    expect(result.at(-1)?.tag).toBe('v1.0.3');
    expect(fetch.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      RELEASES_API,
      nextPage(2),
      nextPage(3),
    ]);
  });

  it('follows next even when the first page has no stable releases', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page([entry('nightly')], `<${nextPage(2)}>; rel="next"`))
      .mockResolvedValueOnce(page([entry('1.0.4')]));
    expect((await fetchNewerReleases(fetch, '1.0.2')).map((release) => release.tag)).toEqual([
      'v1.0.4',
    ]);
  });

  it('fails the entire check if a later page fails, rather than returning incomplete notes', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page([entry('1.0.3')], `<${nextPage(2)}>; rel="next"`))
      .mockResolvedValueOnce(page({ message: 'rate limited' }, '', 403));
    await expect(fetchNewerReleases(fetch, '1.0.2')).rejects.toThrow('GitHub: HTTP 403');
  });

  it('rejects malformed bodies', async () => {
    await expect(fetchNewerReleases(vi.fn().mockResolvedValue(page({})), '1.0.2')).rejects.toThrow(
      'Unexpected answer',
    );
  });

  it.each([
    RELEASES_API,
    'https://example.invalid/releases?page=2',
    'https://api.github.com/other',
  ])('rejects looping or foreign next links: %s', async (next) => {
    const fetch = vi.fn().mockResolvedValue(page([], `<${next}>; rel="next"`));
    await expect(fetchNewerReleases(fetch, '1.0.2')).rejects.toThrow(
      'Invalid GitHub release pagination',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses a single timeout across pages and aborts a stalled response body', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetch = vi
      .fn<Parameters<typeof fetchNewerReleases>[0]>()
      .mockImplementationOnce(async (_url, { signal }) => {
        signals.push(signal);
        await new Promise((resolve) => setTimeout(resolve, 60));
        return page([entry('1.0.3')], `<${nextPage(2)}>; rel="next"`);
      })
      .mockImplementationOnce((_url, { signal }) => {
        signals.push(signal);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () =>
            new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason as Error), {
                once: true,
              });
            }),
        });
      });
    const result = fetchNewerReleases(fetch, '1.0.2', 100);
    const rejected = expect(result).rejects.toThrow('Update check timed out');
    await vi.advanceTimersByTimeAsync(60);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(signals[0]).toBe(signals[1]);
    await vi.advanceTimersByTimeAsync(40);
    await rejected;
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline after successful requests', async () => {
    vi.useFakeTimers();
    await fetchNewerReleases(vi.fn().mockResolvedValue(page([])), '1.0.2');
    expect(vi.getTimerCount()).toBe(0);
  });
});
