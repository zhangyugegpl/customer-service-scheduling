import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  copyFile,
  cp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createDefaultConfig, CURRENT_TEMPLATE_VERSION } from '../contracts/defaultConfig';
import { boundaryStateSchema, scheduleConfigSchema } from '../contracts/schemas';
import type {
  BoundaryState,
  HistorySummary,
  ScheduleConfig,
  ScheduleResult,
  UUID,
  YearMonth,
} from '../contracts/types';

interface Manifest {
  schemaVersion: 1;
  backupFormatVersion: 1;
  activeConfigPath: string;
  updatedAt: string;
  lastTransactionId?: string;
}

interface BackupManifest {
  backupFormatVersion: 1;
  schemaVersion: 1;
  name: string;
  reason: string;
  createdAt: string;
  files: Array<{ path: string; size: number; sha256: string }>;
}

const MANAGED_DIRECTORIES = ['current', 'snapshots', 'schedules', 'boundaries'] as const;

function assertSafeId(value: string, label: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error(`${label} 不是有效 UUID。`);
}

function assertYearMonth(value: string): asserts value is YearMonth {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error(`非法月份：${value}`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const directory = path.join(root, relative);
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

export class DataRepository {
  private readonly manifestPath: string;
  private readonly lockPath: string;
  private lockHandle?: Awaited<ReturnType<typeof open>>;

  constructor(readonly dataDirectory: string) {
    this.manifestPath = path.join(dataDirectory, 'manifest.json');
    this.lockPath = path.join(dataDirectory, 'lock', 'writer.lock');
  }

  async initialize(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    for (const directory of [...MANAGED_DIRECTORIES, 'backups', 'transactions', 'logs', 'lock']) {
      await mkdir(path.join(this.dataDirectory, directory), { recursive: true });
    }
    await this.recoverIncompleteTransactions();
    if (!(await exists(this.manifestPath))) {
      const config = createDefaultConfig();
      await this.atomicWriteJson(path.join(this.dataDirectory, 'current', 'configuration.json'), config);
      await this.atomicWriteJson(this.manifestPath, this.newManifest());
      await this.saveSnapshot(config);
    } else {
      await this.readManifest();
      await this.getConfig();
    }
  }

  async acquireLock(): Promise<void> {
    await mkdir(path.dirname(this.lockPath), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.lockHandle = await open(this.lockPath, 'wx');
        await this.lockHandle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        return;
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== 'EEXIST' || attempt > 0 || await this.lockOwnerIsAlive()) {
          const details = error instanceof Error ? error.message : String(error);
          throw new Error(`数据目录已被另一个实例占用。${details}`);
        }
        // 异常退出可能遗留锁文件；确认记录的进程已不存在后才清理并重试。
        await unlink(this.lockPath);
      }
    }
  }

  async releaseLock(): Promise<void> {
    await this.lockHandle?.close();
    this.lockHandle = undefined;
    if (await exists(this.lockPath)) await unlink(this.lockPath);
  }

  async getConfig(): Promise<ScheduleConfig> {
    const manifest = await this.readManifest();
    const raw = JSON.parse(await readFile(path.join(this.dataDirectory, manifest.activeConfigPath), 'utf8')) as unknown;
    const parsed = scheduleConfigSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`当前配置损坏：${parsed.error.issues.map((value) => value.message).join('；')}`);
    return { ...parsed.data, templateVersion: CURRENT_TEMPLATE_VERSION } as ScheduleConfig;
  }

  async saveConfig(config: ScheduleConfig): Promise<ScheduleConfig> {
    const parsed = scheduleConfigSchema.parse({ ...config, templateVersion: CURRENT_TEMPLATE_VERSION, updatedAt: new Date().toISOString() }) as ScheduleConfig;
    const transactionId = randomUUID();
    const transactionDir = path.join(this.dataDirectory, 'transactions', transactionId);
    await mkdir(transactionDir, { recursive: true });
    const stagedConfig = path.join(transactionDir, 'configuration.json');
    await writeFile(stagedConfig, JSON.stringify(parsed, null, 2), 'utf8');
    scheduleConfigSchema.parse(JSON.parse(await readFile(stagedConfig, 'utf8')));
    const liveConfig = path.join(this.dataDirectory, 'current', 'configuration.json');
    await rename(stagedConfig, liveConfig);
    await this.saveSnapshot(parsed);
    const manifest = this.newManifest(transactionId);
    await this.atomicWriteJson(this.manifestPath, manifest);
    await rm(transactionDir, { recursive: true, force: true });
    return parsed;
  }

  async resetConfig(): Promise<ScheduleConfig> {
    await this.createBackup('重置默认配置前自动备份');
    return this.saveConfig(createDefaultConfig());
  }

  async saveSnapshot(config: ScheduleConfig): Promise<string> {
    const snapshotId = randomUUID();
    await this.atomicWriteJson(path.join(this.dataDirectory, 'snapshots', `${snapshotId}.json`), {
      ...config,
      snapshotId,
      snapshotCreatedAt: new Date().toISOString(),
    });
    return snapshotId;
  }

  async saveSchedule(schedule: ScheduleResult): Promise<ScheduleResult> {
    assertSafeId(schedule.id, '排班 ID');
    assertYearMonth(schedule.targetMonth);
    const directory = path.join(this.dataDirectory, 'schedules', schedule.targetMonth);
    await mkdir(directory, { recursive: true });
    const saved = { ...schedule, updatedAt: new Date().toISOString() };
    await this.atomicWriteJson(path.join(directory, `${schedule.id}.json`), saved);
    if (schedule.boundaryState) await this.saveBoundary(schedule.boundaryState);
    return saved;
  }

  async listHistory(): Promise<HistorySummary[]> {
    const root = path.join(this.dataDirectory, 'schedules');
    const files = (await listFiles(root)).filter((file) => file.endsWith('.json'));
    const summaries: HistorySummary[] = [];
    for (const file of files) {
      const schedule = JSON.parse(await readFile(path.join(root, file), 'utf8')) as ScheduleResult;
      summaries.push({
        id: schedule.id,
        targetMonth: schedule.targetMonth,
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt,
        status: schedule.status,
        solverVersion: schedule.solverVersion,
        issueCount: schedule.issues.length,
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSchedule(id: UUID): Promise<ScheduleResult> {
    assertSafeId(id, '排班 ID');
    const root = path.join(this.dataDirectory, 'schedules');
    const files = (await listFiles(root)).filter((file) => path.basename(file) === `${id}.json`);
    if (files.length !== 1) throw new Error('未找到指定排班历史。');
    return JSON.parse(await readFile(path.join(root, files[0]!), 'utf8')) as ScheduleResult;
  }

  async saveBoundary(boundary: BoundaryState): Promise<void> {
    boundaryStateSchema.parse(boundary);
    assertYearMonth(boundary.sourceMonth);
    await this.atomicWriteJson(path.join(this.dataDirectory, 'boundaries', `${boundary.sourceMonth}.json`), boundary);
  }

  async getBoundary(sourceMonth: YearMonth): Promise<BoundaryState | undefined> {
    assertYearMonth(sourceMonth);
    const file = path.join(this.dataDirectory, 'boundaries', `${sourceMonth}.json`);
    if (!(await exists(file))) return undefined;
    return boundaryStateSchema.parse(JSON.parse(await readFile(file, 'utf8'))) as BoundaryState;
  }

  async createBackup(reason: string): Promise<string> {
    const createdAt = new Date().toISOString();
    const name = `${createdAt.replaceAll(':', '-').replaceAll('.', '-')}-schema1`;
    const root = path.join(this.dataDirectory, 'backups', name);
    await mkdir(root, { recursive: true });
    for (const directory of MANAGED_DIRECTORIES) {
      const source = path.join(this.dataDirectory, directory);
      if (await exists(source)) await cp(source, path.join(root, directory), { recursive: true, force: false });
    }
    if (await exists(this.manifestPath)) await copyFile(this.manifestPath, path.join(root, 'manifest.json'));
    const files = await listFiles(root);
    const manifest: BackupManifest = {
      backupFormatVersion: 1,
      schemaVersion: 1,
      name,
      reason,
      createdAt,
      files: await Promise.all(files.filter((file) => file !== 'backup-manifest.json').map(async (file) => {
        const fullPath = path.join(root, file);
        return { path: file, size: (await stat(fullPath)).size, sha256: await sha256(fullPath) };
      })),
    };
    await this.atomicWriteJson(path.join(root, 'backup-manifest.json'), manifest);
    await this.pruneBackups(5);
    return name;
  }

  async listBackups(): Promise<Array<{ name: string; createdAt: string; schemaVersion: number }>> {
    const root = path.join(this.dataDirectory, 'backups');
    const entries = await readdir(root, { withFileTypes: true });
    const result: Array<{ name: string; createdAt: string; schemaVersion: number }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(root, entry.name, 'backup-manifest.json');
      if (!(await exists(manifestPath))) continue;
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifest;
      result.push({ name: manifest.name, createdAt: manifest.createdAt, schemaVersion: manifest.schemaVersion });
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async restoreBackup(name: string): Promise<void> {
    if (!/^[\w.-]+$/u.test(name)) throw new Error('备份名称无效。');
    const backupRoot = path.join(this.dataDirectory, 'backups', name);
    const manifestPath = path.join(backupRoot, 'backup-manifest.json');
    if (!(await exists(manifestPath))) throw new Error('备份不存在或清单缺失。');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifest;
    for (const file of manifest.files) {
      const source = path.join(backupRoot, file.path);
      if (!(await exists(source)) || await sha256(source) !== file.sha256) throw new Error(`备份文件校验失败：${file.path}`);
    }
    await this.createBackup(`恢复备份 ${name} 前的保护性备份`);
    const transactionId = randomUUID();
    const stage = path.join(this.dataDirectory, 'transactions', transactionId);
    await mkdir(stage, { recursive: true });
    for (const directory of MANAGED_DIRECTORIES) {
      const source = path.join(backupRoot, directory);
      if (await exists(source)) await cp(source, path.join(stage, directory), { recursive: true });
    }
    for (const directory of MANAGED_DIRECTORIES) {
      const destination = path.join(this.dataDirectory, directory);
      const staged = path.join(stage, directory);
      if (!(await exists(staged))) continue;
      await rm(destination, { recursive: true, force: true });
      await rename(staged, destination);
    }
    await copyFile(path.join(backupRoot, 'manifest.json'), this.manifestPath);
    await rm(stage, { recursive: true, force: true });
    await this.getConfig();
  }

  private newManifest(lastTransactionId?: string): Manifest {
    return {
      schemaVersion: 1,
      backupFormatVersion: 1,
      activeConfigPath: 'current/configuration.json',
      updatedAt: new Date().toISOString(),
      lastTransactionId,
    };
  }

  private async readManifest(): Promise<Manifest> {
    const manifest = JSON.parse(await readFile(this.manifestPath, 'utf8')) as Manifest;
    if (manifest.schemaVersion !== 1 || manifest.backupFormatVersion !== 1 || manifest.activeConfigPath !== 'current/configuration.json') {
      throw new Error('数据清单版本不受支持。');
    }
    return manifest;
  }

  private async atomicWriteJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    JSON.parse(await readFile(temporary, 'utf8'));
    await rename(temporary, filePath);
  }

  private async recoverIncompleteTransactions(): Promise<void> {
    const root = path.join(this.dataDirectory, 'transactions');
    if (!(await exists(root))) return;
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) await rm(path.join(root, entry.name), { recursive: true, force: true });
    }
  }

  private async pruneBackups(limit: number): Promise<void> {
    const backups = await this.listBackups();
    for (const backup of backups.slice(limit)) {
      await rm(path.join(this.dataDirectory, 'backups', backup.name), { recursive: true, force: true });
    }
  }

  private async lockOwnerIsAlive(): Promise<boolean> {
    try {
      const lock = JSON.parse(await readFile(this.lockPath, 'utf8')) as { pid?: unknown };
      if (!Number.isInteger(lock.pid) || Number(lock.pid) <= 0) return false;
      process.kill(Number(lock.pid), 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // EPERM 表示目标进程存在但当前用户无权发送信号。
      return code === 'EPERM';
    }
  }
}
