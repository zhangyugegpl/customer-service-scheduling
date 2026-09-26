import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../packages/contracts/defaultConfig';
import { scheduleConfigSchema } from '../../packages/contracts/schemas';
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
  it('排班 Excel 包含右侧岗位统计、底部每日统计和公式缓存结果', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'schedule.xlsx');
    const { config, schedule } = sampleSchedule();
    await exportScheduleWorkbook(filePath, config, schedule);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.getWorksheet('排班表')!;
    expect(sheet).toBeTruthy();
    expect(workbook.getWorksheet('统计')).toBeTruthy();
    const dates = getMonthDates('2026-10');
    const statisticsStartColumn = 3 + dates.length;
    expect(sheet.getCell(2, statisticsStartColumn).value).toBe('早班天数');
    const employeeFormula = sheet.getCell(3, statisticsStartColumn).value as ExcelJS.CellFormulaValue;
    expect(employeeFormula.formula).toBe('COUNTIF(C3:AG3,"早班")');
    expect(employeeFormula.result).toBe(30);

    const summaryStartRow = 3 + config.employees.length;
    expect(sheet.getCell(summaryStartRow, 2).value).toBe('休');
    const restFormula = sheet.getCell(summaryStartRow, 3).value as ExcelJS.CellFormulaValue;
    expect(restFormula.formula).toBe('COUNTIF(C$3:C$11,"休息")');
    expect(restFormula.result).toBe(1);
    const totalRow = summaryStartRow + config.positions.length + 1;
    expect(sheet.getCell(totalRow, 2).value).toBe('总计');
    const totalFormula = sheet.getCell(totalRow, 3).value as ExcelJS.CellFormulaValue;
    expect(totalFormula.formula).toBe('COUNTA(C$3:C$11)');
    expect(totalFormula.result).toBe(config.employees.length);
    const positionTotalFormula = sheet.getCell(totalRow, statisticsStartColumn).value as ExcelJS.CellFormulaValue;
    expect(positionTotalFormula.formula).toBe('SUM(AH$3:AH$11)');
    expect(positionTotalFormula.result).toBe(92);
  });

  it('配置模板可以往返导入', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'config.xlsx');
    const config = createDefaultConfig();
    config.rules.middleShiftMaxRange = 2;
    config.softConstraints.modes.S2 = 'HARD';
    config.softConstraints.highestPriority = config.softConstraints.highestPriority.filter((key) => key !== 'S2');
    await exportConfigurationTemplate(filePath, config);
    const imported = await importConfigurationWorkbook(filePath);
    expect(imported.employees).toHaveLength(config.employees.length);
    expect(imported.positions).toHaveLength(config.positions.length);
    expect(imported.positions[0]!.defaultMinQuota).toBe(config.positions[0]!.defaultMinQuota);
    expect(imported.rules.middleShiftMaxRange).toBe(2);
    expect(imported.softConstraints.modes.S2).toBe('HARD');
    expect(imported.softConstraints.highestPriority).not.toContain('S2');
  });

  it('配置模板往返保留指定日期连续范围', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'config-range.xlsx');
    const config = createDefaultConfig();
    config.specifiedAssignments.push({
      id: '10000000-0000-4000-8000-000000000021',
      employeeId: config.employees[0]!.id,
      date: '2026-10-03',
      endDate: '2026-10-05',
      state: 'OFF',
      locked: true,
    });
    config.specifiedRestCounts.push({
      id: '10000000-0000-4000-8000-000000000022',
      date: '2026-10-08',
      endDate: '2026-10-10',
      count: 2,
    });
    await exportConfigurationTemplate(filePath, config);

    const imported = await importConfigurationWorkbook(filePath);
    expect(imported.specifiedAssignments[0]).toMatchObject({ date: '2026-10-03', endDate: '2026-10-05', state: 'OFF' });
    expect(imported.specifiedRestCounts[0]).toMatchObject({ date: '2026-10-08', endDate: '2026-10-10', count: 2 });
  });

  it('导入时会将 Excel 中的非法 ID 规范化为 UUID', async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, 'invalid-ids.xlsx');
    const config = createDefaultConfig();
    const [early, middle, review, backoffice] = config.positions;
    early!.id = 'EARLY';
    middle!.id = 'MIDDLE';
    review!.id = 'REVIEW';
    backoffice!.id = 'BACKOFFICE';
    config.employees.forEach((employee, index) => {
      employee.id = `EMPLOYEE-${index + 1}`;
      employee.skillPositionIds = [early!.id, middle!.id, review!.id, backoffice!.id];
    });
    config.rules.groups = [{
      id: 'GROUP-001',
      name: '测试同休组',
      employeeIds: [config.employees[0]!.id, config.employees[1]!.id, config.employees[2]!.id],
    }];
    config.rules.exclusionPairs = [{
      id: 'PAIR-001',
      name: '测试互斥对',
      employeeIds: [config.employees[3]!.id, config.employees[4]!.id],
    }];
    await exportConfigurationTemplate(filePath, config);

    const imported = await importConfigurationWorkbook(filePath);
    expect(() => scheduleConfigSchema.parse(imported)).not.toThrow();
    expect(imported.rules.groups[0]!.id).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(imported.rules.exclusionPairs[0]!.id).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(imported.employees.every((employee) => /^[0-9a-f-]{36}$/iu.test(employee.id))).toBe(true);
    expect(imported.positions.every((position) => /^[0-9a-f-]{36}$/iu.test(position.id))).toBe(true);
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
