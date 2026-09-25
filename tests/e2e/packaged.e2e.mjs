import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const executablePath = path.join(projectRoot, 'release', 'win-unpacked', '客服排班计划工具.exe');
const packagedSolver = path.join(projectRoot, 'release', 'win-unpacked', 'resources', 'solver', 'scheduler-solver.exe');
await access(executablePath);
await access(packagedSolver);

const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'css-packaged-e2e-'));
const outputDirectory = path.join(projectRoot, 'test-results');
await mkdir(outputDirectory, { recursive: true });
const environment = {
  ...process.env,
  CSS_SCHEDULER_DATA_DIR: dataDirectory,
  ELECTRON_ENABLE_LOGGING: '1',
};
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.CSS_PYTHON_EXECUTABLE;
delete environment.CSS_SOLVER_PATH;
delete environment.PYTHONPATH;

let electronApp;
try {
  electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${path.join(dataDirectory, 'electron-profile')}`],
    env: environment,
    timeout: 60_000,
  });
  electronApp.process().stdout?.on('data', (chunk) => process.stderr.write(`[main:stdout] ${chunk}`));
  electronApp.process().stderr?.on('data', (chunk) => process.stderr.write(`[main:stderr] ${chunk}`));
  const page = await electronApp.firstWindow();
  page.on('console', (message) => process.stderr.write(`[packaged:${message.type()}] ${message.text()}\n`));
  page.on('pageerror', (error) => process.stderr.write(`[packaged:error] ${error.stack ?? error.message}\n`));
  await page.waitForLoadState('domcontentloaded');
  process.stderr.write(`[packaged:page] url=${page.url()} title=${await page.title()}\n`);
  try {
    await page.waitForSelector('.brand', { timeout: 30_000 });
  } catch (error) {
    await page.screenshot({ path: path.join(outputDirectory, 'e2e-packaged-failure.png'), fullPage: true });
    process.stderr.write(`[packaged:html] ${(await page.content()).slice(0, 4_000)}\n`);
    throw error;
  }
  assert.match(await page.title(), /客服排班计划工具/);

  await page.locator('.month-control input').fill('2026-11');
  await page.locator('.topbar .primary-button').click();
  await page.waitForSelector('.status-banner.publishable', { timeout: 60_000 });
  assert.equal(await page.locator('.schedule-table tbody tr').count(), 9);
  await page.getByRole('button', { name: '保存版本' }).click();
  await page.waitForSelector('.toast.success', { timeout: 10_000 });
  await page.getByRole('button', { name: /历史记录/ }).click();
  assert.ok(await page.locator('.editor-table tbody tr').count() >= 1);
  await page.getByRole('button', { name: '打开' }).first().click();
  await page.waitForSelector('.schedule-table');
  await page.screenshot({ path: path.join(outputDirectory, 'e2e-packaged-schedule.png'), fullPage: true });
  process.stdout.write('PACKAGED_E2E_OK：成品应用使用内置求解器完成生成、保存与历史查看。\n');
} finally {
  if (electronApp) await electronApp.close();
  await rm(dataDirectory, { recursive: true, force: true });
}
