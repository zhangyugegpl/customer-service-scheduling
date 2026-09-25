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
  await page.locator('.topbar .primary-button').click();
  await page.waitForSelector('.status-banner.publishable', { timeout: 30_000 });
  await page.waitForSelector('.schedule-table tbody tr', { timeout: 10_000 });
  assert.equal(await page.locator('.schedule-table tbody tr').count(), 9);

  await page.getByRole('button', { name: '保存版本' }).click();
  await page.waitForSelector('.toast.success', { timeout: 10_000 });
  await page.getByRole('button', { name: /历史记录/ }).click();
  await page.waitForSelector('.editor-table tbody tr', { timeout: 10_000 });
  assert.ok(await page.locator('.editor-table tbody tr').count() >= 1);

  await page.getByRole('button', { name: '打开' }).first().click();
  await page.waitForSelector('.schedule-table');
  await page.screenshot({ path: path.join(outputDirectory, 'e2e-schedule.png'), fullPage: true });
  process.stdout.write('E2E_OK：启动 → 选择月份 → 生成排班 → 查看排班 → 保存版本 → 打开历史，全部通过。\n');
} finally {
  if (electronApp) await electronApp.close();
  await rm(dataDirectory, { recursive: true, force: true });
}
