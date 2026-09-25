import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../packages/contracts/defaultConfig';
import type { Assignment, ScheduleResult } from '../../packages/contracts/types';
import { exportConfigurationTemplate, exportScheduleCsv, exportScheduleWorkbook, importConfigurationWorkbook } from '../../packages/excel/service';
import { getMonthDates } from '../../packages/domain/date';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'css-excel-'));
  directories.push(directory);
  return directory;
}

function sampleSchedule(): { config: ReturnType<typeof createDefaultConfig>; schedule: ScheduleResult } {
  const config = createDefaultConfig();
  config.rules.groups = [];
  config.rules.exclusionPairs = [];
  config.employees.forEach((employee) => {
    employee.monthlyRestDays = 0;
    employee.skillPositionIds = config.positions.map((position) => position.id);
  });
  const assignments: Assignment[] = [];
  for (const day of getMonthDates('2026-10')) {
    config.employees.forEach((employee, index) => assignments.push({ employeeId: employee.id, date: day, state: config.positions[index % config.positions.length]!.id }));
  }
  assignments.find((assignment) => assignment.employeeId === config.employees[0]!.id)!.state = 'OFF';
  const now = new Date().toISOString();
  return {
    config,
    schedule: {
      schemaVersion: 1,
      id: '10000000-0000-4000-8000-000000000001',
      targetMonth: '2026-10',
      createdAt: now,
      updatedAt: now,
      status: 'PUBLISHABLE',
      solverVersion: 'test',
      randomSeed: 1,
      assignments,
      issues: [],
      softScores: [],
      metrics: { status: 'TEST', wallTimeMs: 1 },
      crossMonthVerified: false,
      manualChanges: [],
      exportRecords: [],
    },
  };
}

describe('Excel 导入导出', () => {
  it('排班 Excel 包含明细、统计、元数据和公式缓存结果', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'schedule.xlsx');
    const { config, schedule } = sampleSchedule();
    await exportScheduleWorkbook(filePath, config, schedule);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    expect(workbook.getWorksheet('排班表')).toBeTruthy();
    expect(workbook.getWorksheet('统计')).toBeTruthy();
    const formula = workbook.getWorksheet('排班表')!.getCell(3, 34).value as ExcelJS.CellFormulaValue;
    expect(formula.formula).toContain('COUNTIF');
    expect(formula.result).toBe(1);
  });

  it('配置模板可以往返导入', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'config.xlsx');
    const config = createDefaultConfig();
    await exportConfigurationTemplate(filePath, config);
    const imported = await importConfigurationWorkbook(filePath);
    expect(imported.employees).toHaveLength(config.employees.length);
    expect(imported.positions).toHaveLength(config.positions.length);
    expect(imported.positions[0]!.defaultMinQuota).toBe(config.positions[0]!.defaultMinQuota);
  });

  it('CSV 以 BOM 开头', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'schedule.csv');
    const { config, schedule } = sampleSchedule();
    await exportScheduleCsv(filePath, config, schedule);
    const content = await import('node:fs/promises').then(({ readFile }) => readFile(filePath, 'utf8'));
    expect(content.charCodeAt(0)).toBe(0xfeff);
  });
});
