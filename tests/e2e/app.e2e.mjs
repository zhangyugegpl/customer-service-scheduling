import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'css-e2e-data-'));
const outputDirectory = path.join(projectRoot, 'test-results');
await mkdir(outputDirectory, { recursive: true });
const environment = {
  ...process.env,
  CSS_SCHEDULER_DATA_DIR: dataDirectory,
  CSS_PYTHON_EXECUTABLE: 'python',
};
delete environment.ELECTRON_RUN_AS_NODE;

let electronApp;
try {
  electronApp = await electron.launch({
    args: [`--user-data-dir=${path.join(dataDirectory, 'electron-profile')}`, '.'],
    cwd: projectRoot,
    env: environment,
    timeout: 60_000,
  });
  const page = await electronApp.firstWindow();
  page.on('console', (message) => process.stderr.write(`[renderer:${message.type()}] ${message.text()}\n`));
  page.on('pageerror', (error) => process.stderr.write(`[renderer:error] ${error.stack ?? error.message}\n`));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.brand', { timeout: 30_000 });
  assert.match(await page.title(), /客服排班计划工具/);

  const monthInput = page.locator('.month-control input');
  await monthInput.fill('2026-10');
  await page.getByRole('button', { name: /排班规则/ }).click();
  await page.getByLabel('S2 规则强度').selectOption('HARD');
  assert.equal(await page.getByLabel('S2 规则强度').inputValue(), 'HARD');
  assert.equal(await page.getByLabel('S2 同层权重').isDisabled(), true);
  await page.getByLabel('中班允许最大极差').fill('3');
  await page.locator('.topbar .primary-button').click();
  await page.waitForSelector('.status-banner, .toast.error', { timeout: 30_000 });
  if (await page.locator('.toast.error').count()) {
    throw new Error(`生成排班失败：${await page.locator('.toast.error').innerText()}`);
  }
  const savedConfig = await page.evaluate(() => window.schedulerApi.getConfig());
  assert.equal(await page.locator('.status-banner.publishable').count(), 1, `未生成可发布排班：${await page.locator('.status-banner').innerText()}\n${await page.locator('.issue-card').innerText()}\n${JSON.stringify({ modes: savedConfig.softConstraints.modes, highestPriority: savedConfig.softConstraints.highestPriority, middleShiftMaxRange: savedConfig.rules.middleShiftMaxRange })}`);
  await page.waitForSelector('.schedule-table tbody tr', { timeout: 10_000 });
  assert.equal(await page.locator('.schedule-table tbody tr').count(), 9);
  assert.equal(await page.locator('.schedule-table thead .summary-col').count(), 5);
  assert.deepEqual(await page.locator('.schedule-table thead .summary-col').allTextContents(), ['休', '早', '中', '审单', '后台']);
  assert.equal((await page.locator('.schedule-table tbody tr').first().locator('.summary-cell').allTextContents())[0], '6');
  assert.equal(await page.locator('.schedule-table tfoot tr').count(), 6);
  await page.waitForSelector('.score-card');
  assert.match(await page.locator('.score-card').innerText(), /S2 · 必须满足/);
  assert.match(await page.locator('.score-card').innerText(), /实际极差 [0-3] \/ 目标 ≤ 3/);
  await page.locator('.schedule-scroll').evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await page.locator('.schedule-card').screenshot({ path: path.join(outputDirectory, 'e2e-schedule-statistics.png') });

  await page.getByRole('button', { name: '保存版本' }).click();
  await page.waitForSelector('.toast.success', { timeout: 10_000 });
  await page.getByRole('button', { name: /历史记录/ }).click();
  await page.waitForSelector('.editor-table tbody tr', { timeout: 10_000 });
  assert.ok(await page.locator('.editor-table tbody tr').count() >= 1);

  await page.getByRole('button', { name: '打开' }).first().click();
  await page.waitForSelector('.schedule-table');
  await page.screenshot({ path: path.join(outputDirectory, 'e2e-schedule-viewport.png') });
  await page.screenshot({ path: path.join(outputDirectory, 'e2e-schedule.png'), fullPage: true });

  await page.getByRole('button', { name: /排班规则/ }).click();
  await page.getByRole('button', { name: '新增员工指定' }).click();
  const specifiedRow = page.locator('.editor-table tbody tr').first();
  await specifiedRow.getByLabel('指定开始日期').fill('2026-10-03');
  await specifiedRow.getByLabel('指定结束日期').fill('2026-10-05');
  assert.equal(await specifiedRow.getByLabel('指定开始日期').inputValue(), '2026-10-03');
  assert.equal(await specifiedRow.getByLabel('指定结束日期').inputValue(), '2026-10-05');
  await page.locator('.editor-table').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDirectory, 'e2e-rules-date-range-viewport.png') });
  await page.screenshot({ path: path.join(outputDirectory, 'e2e-rules-date-range.png'), fullPage: true });
  await page.getByRole('button', { name: /排班预览/ }).click();
  await page.waitForSelector('.outdated-banner');
  process.stdout.write('E2E_OK：S2 强规则 → 生成排班 → 统计看板 → 保存版本 → 打开历史 → 连续日期指定 → 旧结果提醒，全部通过。\n');
} finally {
  if (electronApp) await electronApp.close();
  await rm(dataDirectory, { recursive: true, force: true });
}
