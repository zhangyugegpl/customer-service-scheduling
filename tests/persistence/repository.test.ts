import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DataRepository } from '../../packages/persistence/repository';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createRepository(): Promise<DataRepository> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'css-repository-'));
  directories.push(directory);
  const repository = new DataRepository(directory);
  await repository.initialize();
  return repository;
}

describe('DataRepository', () => {
  it('首次初始化创建默认配置并支持保存', async () => {
    const repository = await createRepository();
    const config = await repository.getConfig();
    expect(config.employees).toHaveLength(9);
    config.name = '测试客服组';
    await repository.saveConfig(config);
    expect((await repository.getConfig()).name).toBe('测试客服组');
  });

  it('备份后可恢复配置', async () => {
    const repository = await createRepository();
    const original = await repository.getConfig();
    const backupName = await repository.createBackup('测试备份');
    original.name = '已修改';
    await repository.saveConfig(original);
    await repository.restoreBackup(backupName);
    expect((await repository.getConfig()).name).toBe('默认客服组');
  });

  it('排班历史可保存和读取', async () => {
    const repository = await createRepository();
    const now = new Date().toISOString();
    const schedule = {
      schemaVersion: 1 as const,
      id: '10000000-0000-4000-8000-000000000001',
      targetMonth: '2026-10',
      createdAt: now,
      updatedAt: now,
      status: 'PUBLISHABLE' as const,
      solverVersion: 'test',
      randomSeed: 1,
      assignments: [],
      issues: [],
      softScores: [],
      metrics: { status: 'TEST', wallTimeMs: 0 },
      crossMonthVerified: false,
      manualChanges: [],
      exportRecords: [],
    };
    await repository.saveSchedule(schedule);
    expect(await repository.listHistory()).toHaveLength(1);
    expect((await repository.getSchedule(schedule.id)).targetMonth).toBe('2026-10');
  });

  it('异常退出遗留的失效写锁可自动恢复', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'css-repository-lock-'));
    directories.push(directory);
    await mkdir(path.join(directory, 'lock'), { recursive: true });
    await writeFile(path.join(directory, 'lock', 'writer.lock'), JSON.stringify({ pid: 2_147_483_647 }), 'utf8');
    const repository = new DataRepository(directory);
    await repository.acquireLock();
    await repository.releaseLock();
  });
});
