import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { SchedulingService } from '../../../packages/application/schedulingService';
import { scheduleConfigSchema, generateScheduleRequestSchema } from '../../../packages/contracts/schemas';
import type {
  AssignmentState,
  GenerateScheduleRequest,
  ScheduleConfig,
  ScheduleResult,
  SchedulerApi,
  ValidationIssue,
} from '../../../packages/contracts/types';
import { forceAssignmentChange, validateConfig, validateSchedule } from '../../../packages/domain';
import {
  exportConfigurationJson,
  exportConfigurationTemplate,
  exportScheduleCsv,
  exportScheduleWorkbook,
  importBoundaryWorkbook,
  importConfigurationJson,
  importConfigurationWorkbook,
} from '../../../packages/excel/service';
import { DataRepository } from '../../../packages/persistence/repository';
import { SolverClient } from '../../../packages/solver-client/client';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = app.isPackaged ? app.getAppPath() : path.resolve(currentDirectory, '..');
// app.asar 是文件而非目录，不能作为 Windows 子进程的 cwd。
const solverWorkingDirectory = app.isPackaged ? process.resourcesPath : applicationRoot;
const dataDirectory = process.env.CSS_SCHEDULER_DATA_DIR
  ? path.resolve(process.env.CSS_SCHEDULER_DATA_DIR)
  : path.join(app.getPath('userData'), 'scheduler-data');
const repository = new DataRepository(dataDirectory);
const solver = new SolverClient({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  projectRoot: solverWorkingDirectory,
  solverPathOverride: process.env.CSS_SOLVER_PATH,
  pythonExecutable: process.env.CSS_PYTHON_EXECUTABLE,
});
const scheduling = new SchedulingService(solver);

let mainWindow: BrowserWindow | undefined;

function verifySender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  const validDevelopment = !app.isPackaged && /^http:\/\/127\.0\.0\.1:5173(?:\/|$)/.test(url);
  const validBuiltDevelopment = !app.isPackaged && !process.env.VITE_DEV_SERVER_URL && url.startsWith('file://');
  const validProduction = app.isPackaged && url.startsWith('file://');
  if (!validDevelopment && !validBuiltDevelopment && !validProduction) throw new Error('拒绝来自非可信页面的请求。');
}

function handle<Args extends unknown[], Result>(
  channel: string,
  callback: (...args: Args) => Promise<Result> | Result,
): void {
  ipcMain.handle(channel, async (event, ...args: Args) => {
    verifySender(event);
    return callback(...args);
  });
}

function schemaIssues(error: unknown): ValidationIssue[] {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    return error.issues.map((value: { path?: PropertyKey[]; message?: string }) => ({
      code: 'SCHEMA_INVALID',
      severity: 'ERROR' as const,
      sourceIds: [],
      actual: value.path?.join('.') ?? '',
      message: `配置格式错误：${value.path?.join('.') ?? ''} ${value.message ?? ''}`,
    }));
  }
  return [{ code: 'IMPORT_FAILED', severity: 'ERROR', sourceIds: [], message: error instanceof Error ? error.message : String(error) }];
}

async function exportSchedule(schedule: ScheduleResult, format: 'XLSX' | 'CSV') {
  if (schedule.status === 'INFEASIBLE' || schedule.status === 'TIMEOUT') {
    return { ok: false, message: '无可行方案或超时结果不能导出。' };
  }
  if (schedule.status === 'EXCEPTION' && !schedule.exceptionReason?.trim()) {
    return { ok: false, message: '有例外方案导出前必须填写确认原因。' };
  }
  const extension = format === 'XLSX' ? 'xlsx' : 'csv';
  const selected = await dialog.showSaveDialog(mainWindow!, {
    title: `导出${format === 'XLSX' ? ' Excel' : ' CSV'} 排班`,
    defaultPath: `${schedule.targetMonth}-客服排班-${schedule.status === 'EXCEPTION' ? '例外方案' : '正式版'}.${extension}`,
    filters: [{ name: format, extensions: [extension] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (selected.canceled || !selected.filePath) return { ok: false, canceled: true, message: '已取消导出。' };
  const config = await repository.getConfig();
  if (format === 'XLSX') await exportScheduleWorkbook(selected.filePath, config, schedule);
  else await exportScheduleCsv(selected.filePath, config, schedule);
  schedule.exportRecords.push({ id: randomUUID(), exportedAt: new Date().toISOString(), format, fileName: path.basename(selected.filePath) });
  await repository.saveSchedule(schedule);
  return { ok: true, message: '导出完成。', filePath: selected.filePath };
}

function registerIpc(): void {
  handle('app:getInfo', async () => ({
    appVersion: app.getVersion(),
    schemaVersion: 1,
    solverVersion: (await solver.health()).solverVersion,
    dataDirectory,
    packaged: app.isPackaged,
  }));
  handle('config:get', () => repository.getConfig());
  handle('config:save', (config: ScheduleConfig) => repository.saveConfig(scheduleConfigSchema.parse(config) as ScheduleConfig));
  handle('config:reset', () => repository.resetConfig());
  handle('config:validate', (config: ScheduleConfig, targetMonth: string, boundary?: Parameters<typeof validateConfig>[2]) => validateConfig(config, targetMonth, boundary));
  handle('schedule:generate', (request: GenerateScheduleRequest) => scheduling.generate(generateScheduleRequestSchema.parse(request) as GenerateScheduleRequest));
  handle('schedule:validate', (config: ScheduleConfig, schedule: ScheduleResult) => validateSchedule(config, schedule));
  handle('schedule:forceChange', (config: ScheduleConfig, schedule: ScheduleResult, change: { employeeId: string; date: string; state: AssignmentState; reason?: string }) => (
    forceAssignmentChange(config, schedule, change.employeeId, change.date, change.state, change.reason)
  ));
  handle('schedule:smartRepair', async (config: ScheduleConfig, schedule: ScheduleResult, change: { employeeId: string; date: string; state: AssignmentState }) => {
    const repaired = await scheduling.generate({
      config,
      targetMonth: schedule.targetMonth,
      boundaryState: schedule.boundaryState,
      currentAssignments: schedule.assignments,
      requestedChange: change,
      timeLimitSeconds: 5,
      randomSeed: schedule.randomSeed,
    });
    if (repaired.assignments.length > 0) {
      const before = schedule.assignments.find((value) => value.employeeId === change.employeeId && value.date === change.date)?.state;
      repaired.manualChanges = [
        ...schedule.manualChanges,
        {
          id: randomUUID(),
          changedAt: new Date().toISOString(),
          employeeId: change.employeeId,
          date: change.date,
          before: before ?? 'OFF',
          after: change.state,
          mode: 'SMART',
        },
      ];
    }
    return repaired;
  });
  handle('schedule:save', (schedule: ScheduleResult) => repository.saveSchedule(schedule));
  handle('history:list', () => repository.listHistory());
  handle('history:get', (id: string) => repository.getSchedule(id));
  handle('schedule:export', (schedule: ScheduleResult, format: 'XLSX' | 'CSV') => exportSchedule(schedule, format));

  handle('config:importExcel', async () => {
    const selected = await dialog.showOpenDialog(mainWindow!, { title: '导入配置模板', filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'] });
    if (selected.canceled || !selected.filePaths[0]) return { issues: [], canceled: true };
    try {
      const config = await importConfigurationWorkbook(selected.filePaths[0]);
      scheduleConfigSchema.parse(config);
      return { config, issues: [] };
    } catch (error) {
      return { issues: schemaIssues(error) };
    }
  });
  handle('config:exportTemplate', async (config: ScheduleConfig) => {
    const selected = await dialog.showSaveDialog(mainWindow!, { title: '导出配置模板', defaultPath: '客服排班配置模板.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (selected.canceled || !selected.filePath) return { ok: false, canceled: true, message: '已取消导出。' };
    await exportConfigurationTemplate(selected.filePath, config);
    return { ok: true, message: '配置模板已导出。', filePath: selected.filePath };
  });
  handle('config:exportJson', async (config: ScheduleConfig) => {
    const selected = await dialog.showSaveDialog(mainWindow!, { title: '导出配置 JSON', defaultPath: '客服排班配置.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return { ok: false, canceled: true, message: '已取消导出。' };
    await exportConfigurationJson(selected.filePath, config);
    return { ok: true, message: '配置 JSON 已导出。', filePath: selected.filePath };
  });
  handle('config:importJson', async () => {
    const selected = await dialog.showOpenDialog(mainWindow!, { title: '导入配置 JSON', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (selected.canceled || !selected.filePaths[0]) return { issues: [], canceled: true };
    try {
      const config = scheduleConfigSchema.parse(await importConfigurationJson(selected.filePaths[0])) as ScheduleConfig;
      return { config, issues: [] };
    } catch (error) {
      return { issues: schemaIssues(error) };
    }
  });
  handle('boundary:importExcel', async (config: ScheduleConfig, targetMonth: string) => {
    const selected = await dialog.showOpenDialog(mainWindow!, { title: '导入上月排班', filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'] });
    if (selected.canceled || !selected.filePaths[0]) return { issues: [], canceled: true };
    return importBoundaryWorkbook(selected.filePaths[0], config, targetMonth);
  });
  handle('backup:create', async (reason: string) => ({ ok: true, message: '备份创建完成。', filePath: await repository.createBackup(reason) }));
  handle('backup:list', () => repository.listBackups());
  handle('backup:restore', async (name: string) => {
    await repository.restoreBackup(name);
    return { ok: true, message: '备份恢复完成，请重新核对配置。' };
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: '客服排班计划工具',
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const expected = process.env.VITE_DEV_SERVER_URL;
    if (expected ? !url.startsWith(expected) : !url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  if (process.env.VITE_DEV_SERVER_URL) void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(path.join(applicationRoot, 'dist', 'renderer', 'index.html'));
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    await repository.acquireLock();
    await repository.initialize();
    registerIpc();
    createWindow();
  }).catch((error) => {
    dialog.showErrorBox('启动失败', error instanceof Error ? error.message : String(error));
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { void repository.releaseLock(); });
}

export type MainApiContract = SchedulerApi;
