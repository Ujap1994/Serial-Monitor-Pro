/* global innerWidth, innerHeight -- evaluated in the page */
// Layout regression: in small windows the settings of a tool must not squeeze
// its output to nothing – the page scrolls instead.
import { expect, test } from './fixtures';

const OUTPUTS = [
  ['multiport', 'multiport-output'],
  ['protocol', 'protocol-output'],
  ['frameparser', 'frame-output'],
  ['stop', 'stop-log'],
  ['graph', 'graph-canvas'],
] as const;

for (const [width, height, scrolls] of [
  [1024, 640, true],
  [1280, 800, false],
] as const) {
  test(`tool outputs keep a usable height at ${width}×${height}`, async ({ app, page }) => {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.w, size.h),
      { w: width, h: height },
    );
    await page.waitForTimeout(300);
    // The operating system may keep the window smaller than requested (a CI
    // runner with a small screen); "fits" is only checked at the full size.
    const actual = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const fullSize = actual.w >= width - 2 && actual.h >= height - 2;
    if (!fullSize)
      test.info().annotations.push({ type: 'window', description: JSON.stringify(actual) });
    for (const [tab, output] of OUTPUTS) {
      await page.getByTestId(`tab-${tab}`).click();
      const box = await page.getByTestId(output).boundingBox();
      expect(box?.height ?? 0, `${tab} output height`).toBeGreaterThan(120);
      if (!scrolls && fullSize) {
        const overflow = await page
          .getByTestId(`page-${tab}`)
          .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
        expect(overflow, `${tab} fits without scrolling`).toBe(false);
      }
    }
  });
}
