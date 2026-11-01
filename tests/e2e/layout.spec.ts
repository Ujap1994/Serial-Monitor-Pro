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
      ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setContentSize(w, h),
      [width, height],
    );
    await page.waitForTimeout(300);
    for (const [tab, output] of OUTPUTS) {
      await page.getByTestId(`tab-${tab}`).click();
      const box = await page.getByTestId(output).boundingBox();
      expect(box?.height ?? 0, `${tab} output height`).toBeGreaterThan(120);
      if (!scrolls) {
        const overflow = await page
          .getByTestId(`page-${tab}`)
          .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
        expect(overflow, `${tab} fits without scrolling`).toBe(false);
      }
    }
  });
}
