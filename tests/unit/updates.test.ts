import { describe, expect, it } from 'vitest';
import type { ReleaseInfo } from '@shared/ipc';
import {
  compareVersions,
  newerReleases,
  parseReleases,
  parseVersion,
  releaseChanges,
} from '@shared/core/updates';

const release = (tag: string, extra: Partial<ReleaseInfo> = {}): ReleaseInfo => ({
  tag,
  name: `Serial Monitor Pro ${tag}`,
  url: `https://example.invalid/${tag}`,
  date: '2026-10-18T00:00:00Z',
  body: '',
  draft: false,
  prerelease: false,
  ...extra,
});

describe('versions', () => {
  it('reads versions with and without a leading v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('10.0.7')).toEqual([10, 0, 7]);
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('v1.2.3-beta')).toBeNull();
    expect(parseVersion('01.2.3')).toBeNull();
    expect(parseVersion('9007199254740992.0.0')).toBeNull();
  });

  it('compares numerically, not alphabetically', () => {
    expect(compareVersions('v1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', 'v1.10.0')).toBeLessThan(0);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
  });
});

describe('newerReleases', () => {
  const all = [
    release('v1.0.0'),
    release('v1.0.2'),
    release('v1.1.0'),
    release('v1.0.10'),
    release('v1.2.0', { draft: true }),
    release('v1.3.0', { prerelease: true }),
  ];

  it('lists every published release newer than the running one, newest first', () => {
    expect(newerReleases(all, '1.0.2').map((r) => r.tag)).toEqual(['v1.1.0', 'v1.0.10']);
  });

  it('is empty when the running version is the latest', () => {
    expect(newerReleases(all, '1.1.0')).toEqual([]);
  });

  it('deduplicates versions across pages and ignores malformed tags', () => {
    expect(
      newerReleases(
        [release('v1.0.3'), release('1.0.3'), release('nightly'), release('v1.0.4')],
        '1.0.2',
      ).map((r) => r.tag),
    ).toEqual(['v1.0.4', 'v1.0.3']);
  });
});

describe('parseReleases', () => {
  it('takes the fields the update notice needs and drops entries without a version', () => {
    const parsed = parseReleases([
      {
        tag_name: 'v1.0.3',
        name: 'Serial Monitor Pro 1.0.3',
        html_url: 'https://github.com/x/y/releases/tag/v1.0.3',
        published_at: '2026-11-01T10:00:00Z',
        body: 'notes',
        draft: false,
        prerelease: false,
        assets: [],
      },
      { tag_name: 'nightly', name: 'x' },
      null,
      'garbage',
    ]);
    expect(parsed).toEqual([
      {
        tag: 'v1.0.3',
        name: 'Serial Monitor Pro 1.0.3',
        url: 'https://github.com/x/y/releases/tag/v1.0.3',
        date: '2026-11-01T10:00:00Z',
        body: 'notes',
        draft: false,
        prerelease: false,
      },
    ]);
  });

  it('rejects an answer that is not a list', () => {
    expect(() => parseReleases({ message: 'API rate limit exceeded' })).toThrow();
  });
});

describe('releaseChanges', () => {
  it('keeps only the changes of the release notes', () => {
    const body =
      '## Downloads\r\n\r\n| a | b |\r\n|---|---|\r\n\r\n## Changes\r\n\r\n### Fixed\r\n\r\n- one';
    expect(releaseChanges(body)).toBe('### Fixed\n\n- one');
  });

  it('returns notes without a changes section unchanged', () => {
    expect(releaseChanges('  Just text.  ')).toBe('Just text.');
  });
});
