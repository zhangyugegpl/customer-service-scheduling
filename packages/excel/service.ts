import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { createDefaultConfig } from '../contracts/defaultConfig';
import type {
  BoundaryState,
  ScheduleConfig,
  ScheduleResult,
  SoftConstraintKey,
  ValidationIssue,
} from '../contracts/types';
import { getMonthDates, previousMonth } from '../domain/date';

const TEMPLATE_VERSION = '1.0.0';
const HEADER_FILL = 'FF1F4E78';
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true } as const;
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
  left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
  bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
  right: { style: 'thin', color: { argb: 'FFD9E2F3' } },
};

function argb(color: string): string {
  return `FF${color.replace('#', '').toUpperCase()}`;
}

function columnName(columnNumber: number): string {
  let value = columnNumber;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = BORDER;
  });
  row.height = 24;
}

function stateLabel(config: ScheduleConfig, state: string): string {
  if (state === 'OFF') return '休息';
  return config.positions.find((position) => position.id === state)?.name ?? '未知岗位';
}

function readText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text.trim();
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
  return String(value).trim();
}

function parseInteger(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function splitList(value: string): string[] {
  return value.split(/[，,、;；\s]+/u).map((item) => item.trim()).filter(Boolean);
}

function readUuidOrCreate(cell: ExcelJS.Cell): string {
  const value = readText(cell);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value
    : randomUUID();
}

function metadataSheet(workbook: ExcelJS.Workbook, values: Record<string, string | number>): void {
  const sheet = workbook.addWorksheet('元数据');
  sheet.state = 'veryHidden';
  for (const [key, value] of Object.entries(values)) sheet.addRow([key, value]);
}

export async function exportScheduleWorkbook(
  filePath: string,
  config: ScheduleConfig,
  schedule: ScheduleResult,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '客服排班计划工具';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet('排班表', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const dates = getMonthDates(schedule.targetMonth);
  const activeEmployees = config.employees.filter((employee) => employee.active);
  const statisticsStartColumn = 3 + dates.length;
  const finalColumn = statisticsStartColumn + config.positions.length;
  sheet.mergeCells(1, 1, 1, finalColumn);
  const title = sheet.getCell(1, 1);
  title.value = `${schedule.targetMonth} 客服排班表${schedule.status === 'EXCEPTION' ? '（例外方案）' : ''}`;
  title.font = { size: 16, bold: true, color: { argb: schedule.status === 'EXCEPTION' ? 'FFB91C1C' : 'FF17324D' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  const headers = ['员工编号', '员工姓名', ...dates, '休息天数', ...config.positions.map((position) => `${position.name}天数`)];
  sheet.addRow(headers);
  styleHeader(sheet.getRow(2));
  sheet.getColumn(1).width = 13;
  sheet.getColumn(2).width = 14;
  dates.forEach((_, index) => { sheet.getColumn(index + 3).width = 10; });
  for (let index = statisticsStartColumn; index <= finalColumn; index += 1) sheet.getColumn(index).width = 12;

  const assignmentMap = new Map(schedule.assignments.map((assignment) => [`${assignment.employeeId}|${assignment.date}`, assignment.state]));
  activeEmployees.forEach((employee, employeeIndex) => {
    const rowNumber = employeeIndex + 3;
    const row = sheet.getRow(rowNumber);
    row.getCell(1).value = employee.code;
    row.getCell(2).value = employee.name;
    dates.forEach((date, dateIndex) => {
      const state = assignmentMap.get(`${employee.id}|${date}`) ?? '';
      const cell = row.getCell(dateIndex + 3);
      cell.value = state ? stateLabel(config, state) : '';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (state === 'OFF') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      else {
        const position = config.positions.find((candidate) => candidate.id === state);
        if (position) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(position.color) } };
      }
      cell.border = BORDER;
    });
    const dateStart = `${columnName(3)}${rowNumber}`;
    const dateEnd = `${columnName(2 + dates.length)}${rowNumber}`;
    const restCount = schedule.assignments.filter((assignment) => assignment.employeeId === employee.id && assignment.state === 'OFF').length;
    row.getCell(statisticsStartColumn).value = { formula: `COUNTIF(${dateStart}:${dateEnd},"休息")`, result: restCount };
    config.positions.forEach((position, positionIndex) => {
      const count = schedule.assignments.filter((assignment) => assignment.employeeId === employee.id && assignment.state === position.id).length;
      row.getCell(statisticsStartColumn + positionIndex + 1).value = {
        formula: `COUNTIF(${dateStart}:${dateEnd},"${position.name.replaceAll('"', '""')}")`,
        result: count,
      };
    });
    for (let index = 1; index <= finalColumn; index += 1) row.getCell(index).border = BORDER;
  });

  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + activeEmployees.length, column: finalColumn } };
  sheet.pageSetup.printTitlesRow = '1:2';
  sheet.pageSetup.printArea = `A1:${columnName(finalColumn)}${2 + activeEmployees.length}`;

  const summary = workbook.addWorksheet('统计');
  summary.addRow(['指标', '值']);
  styleHeader(summary.getRow(1));
  summary.addRow(['结果状态', schedule.status]);
  summary.addRow(['求解器版本', schedule.solverVersion]);
  summary.addRow(['随机种子', schedule.randomSeed]);
  summary.addRow(['硬约束问题数', schedule.issues.filter((value) => value.severity === 'ERROR').length]);
  summary.addRow(['跨月完整校验', schedule.crossMonthVerified ? '是' : '否']);
  summary.addRow(['例外确认原因', schedule.exceptionReason ?? '']);
  summary.columns = [{ width: 22 }, { width: 48 }];
  summary.addRow([]);
  summary.addRow(['软约束', '违规数', '得分']);
  styleHeader(summary.getRow(summary.rowCount));
  for (const score of schedule.softScores) summary.addRow([score.ruleId, score.violations, score.score]);

  if (schedule.issues.length > 0) {
    const warning = workbook.addWorksheet('问题清单');
    warning.addRow(['级别', '规则', '员工', '日期', '问题', '期望', '实际']);
    styleHeader(warning.getRow(1));
    for (const problem of schedule.issues) {
      warning.addRow([
        problem.severity,
        problem.ruleId ?? '',
        config.employees.find((employee) => employee.id === problem.employeeId)?.name ?? '',
        problem.date ?? '',
        problem.message,
        problem.expected ?? '',
        problem.actual ?? '',
      ]);
    }
    warning.columns = [{ width: 10 }, { width: 10 }, { width: 14 }, { width: 13 }, { width: 58 }, { width: 16 }, { width: 16 }];
  }

  metadataSheet(workbook, {
    templateVersion: TEMPLATE_VERSION,
    schemaVersion: config.schemaVersion,
    scheduleId: schedule.id,
    targetMonth: schedule.targetMonth,
    status: schedule.status,
    generatedAt: schedule.updatedAt,
  });
  await workbook.xlsx.writeFile(filePath);
}

export async function exportScheduleCsv(filePath: string, config: ScheduleConfig, schedule: ScheduleResult): Promise<void> {
  const dates = getMonthDates(schedule.targetMonth);
  const assignmentMap = new Map(schedule.assignments.map((assignment) => [`${assignment.employeeId}|${assignment.date}`, assignment.state]));
  const escape = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const rows = [
    ['员工编号', '员工姓名', ...dates, '结果状态', '例外原因'],
    ...config.employees.filter((employee) => employee.active).map((employee) => [
      employee.code,
      employee.name,
      ...dates.map((date) => stateLabel(config, assignmentMap.get(`${employee.id}|${date}`) ?? '')),
      schedule.status,
      schedule.exceptionReason ?? '',
    ]),
  ];
  await writeFile(filePath, `\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`, 'utf8');
}

export async function exportConfigurationTemplate(filePath: string, config: ScheduleConfig): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const employees = workbook.addWorksheet('员工信息');
  employees.addRow(['员工ID', '员工编号', '姓名', '在职', '可任岗位（逗号分隔）', '月休天数']);
  styleHeader(employees.getRow(1));
  for (const employee of config.employees) {
    employees.addRow([
      employee.id,
      employee.code,
      employee.name,
      employee.active ? '是' : '否',
      employee.skillPositionIds.map((id) => config.positions.find((position) => position.id === id)?.name).filter(Boolean).join(','),
      employee.monthlyRestDays,
    ]);
  }

  const positions = workbook.addWorksheet('岗位与配额');
  positions.addRow(['岗位ID', '岗位', '颜色', '默认最低配额']);
  styleHeader(positions.getRow(1));
  for (const position of config.positions) positions.addRow([position.id, position.name, position.color, position.defaultMinQuota]);

  const dateQuota = workbook.addWorksheet('日期配额');
  dateQuota.addRow(['日期', '岗位', '最低配额']);
  styleHeader(dateQuota.getRow(1));
  for (const position of config.positions) {
    for (const [day, quota] of Object.entries(position.dateQuotaOverrides)) dateQuota.addRow([day, position.name, quota]);
  }

  const rules = workbook.addWorksheet('排班规则');
  rules.addRow(['规则ID', '类型', '名称', '成员/参数名', '参数值']);
  styleHeader(rules.getRow(1));
  for (const group of config.rules.groups) rules.addRow([group.id, '三人组', group.name, group.employeeIds.map((id) => config.employees.find((employee) => employee.id === id)?.code).join(','), '']);
  for (const pair of config.rules.exclusionPairs) rules.addRow([pair.id, '互斥对', pair.name, pair.employeeIds.map((id) => config.employees.find((employee) => employee.id === id)?.code).join(','), '']);
  for (const [key, value] of Object.entries({
    weeklyWorkMin: config.rules.weeklyWorkMin,
    weeklyWorkMax: config.rules.weeklyWorkMax,
    preferredWeeklyWorkDays: config.rules.preferredWeeklyWorkDays,
    consecutiveRestSegmentsMin: config.rules.consecutiveRestSegmentsMin,
    consecutiveRestSegmentsMax: config.rules.consecutiveRestSegmentsMax,
    workBetweenRestMin: config.rules.workBetweenRestMin,
    workBetweenRestMax: config.rules.workBetweenRestMax,
  })) rules.addRow(['', '参数', key, key, value]);

  const weights = workbook.addWorksheet('约束优先级');
  weights.addRow(['约束项', '是否最高优先级', '同层权重']);
  styleHeader(weights.getRow(1));
  for (const key of ['S1', 'S2', 'S3', 'S4', 'S5'] as SoftConstraintKey[]) {
    weights.addRow([key, config.softConstraints.highestPriority.includes(key) ? '是' : '否', config.softConstraints.weights[key]]);
  }

  const specified = workbook.addWorksheet('指定日期');
  specified.addRow(['规则ID', '员工编号', '日期', '指定类型', '岗位/人数']);
  styleHeader(specified.getRow(1));
  for (const value of config.specifiedAssignments) {
    specified.addRow([
      value.id,
      config.employees.find((employee) => employee.id === value.employeeId)?.code ?? '',
      value.date,
      value.state === 'OFF' ? '休息' : '岗位',
      value.state === 'OFF' ? '' : config.positions.find((position) => position.id === value.state)?.name ?? '',
    ]);
  }
  for (const value of config.specifiedRestCounts) specified.addRow([value.id, '', value.date, '指定休息人数', value.count]);
  metadataSheet(workbook, { templateVersion: TEMPLATE_VERSION, schemaVersion: config.schemaVersion, configId: config.id });
  for (const sheet of workbook.worksheets.filter((candidate) => candidate.name !== '元数据')) {
    sheet.columns.forEach((column) => { column.width = Math.max(14, Math.min(42, column.width ?? 14)); });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  await workbook.xlsx.writeFile(filePath);
}

export async function importConfigurationWorkbook(filePath: string): Promise<ScheduleConfig> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const metadata = workbook.getWorksheet('元数据');
  const version = metadata ? readText(metadata.getCell('B1')) : '';
  if (version !== TEMPLATE_VERSION) throw new Error(`不支持的模板版本：${version || '未声明'}`);
  const positionsSheet = workbook.getWorksheet('岗位与配额');
  const employeesSheet = workbook.getWorksheet('员工信息');
  if (!positionsSheet || !employeesSheet) throw new Error('导入文件缺少“岗位与配额”或“员工信息”Sheet。');

  const base = createDefaultConfig();
  base.id = randomUUID();
  base.name = 'Excel 导入配置';
  base.updatedAt = new Date().toISOString();
  base.positions = [];
  positionsSheet.eachRow((row, number) => {
    if (number === 1) return;
    const name = readText(row.getCell(2));
    if (!name) return;
    base.positions.push({
      id: readUuidOrCreate(row.getCell(1)),
      name,
      color: readText(row.getCell(3)) || '#D9EAF7',
      defaultMinQuota: parseInteger(readText(row.getCell(4))),
      dateQuotaOverrides: {},
    });
  });
  const positionByName = new Map(base.positions.map((position) => [position.name, position]));
  base.employees = [];
  employeesSheet.eachRow((row, number) => {
    if (number === 1) return;
    const name = readText(row.getCell(3));
    if (!name) return;
    base.employees.push({
      id: readUuidOrCreate(row.getCell(1)),
      code: readText(row.getCell(2)) || `AUTO-${number}`,
      name,
      active: !['否', '0', 'false'].includes(readText(row.getCell(4)).toLowerCase()),
      skillPositionIds: splitList(readText(row.getCell(5))).map((positionName) => positionByName.get(positionName)?.id).filter((id): id is string => Boolean(id)),
      monthlyRestDays: parseInteger(readText(row.getCell(6)), 6),
    });
  });
  const employeeByCode = new Map(base.employees.map((employee) => [employee.code, employee]));

  const dateQuota = workbook.getWorksheet('日期配额');
  dateQuota?.eachRow((row, number) => {
    if (number === 1) return;
    const position = positionByName.get(readText(row.getCell(2)));
    const day = readText(row.getCell(1));
    if (position && /^\d{4}-\d{2}-\d{2}$/.test(day)) position.dateQuotaOverrides[day] = parseInteger(readText(row.getCell(3)));
  });

  base.rules.groups = [];
  base.rules.exclusionPairs = [];
  const rulesSheet = workbook.getWorksheet('排班规则');
  rulesSheet?.eachRow((row, number) => {
    if (number === 1) return;
    const type = readText(row.getCell(2));
    const name = readText(row.getCell(3));
    const members = splitList(readText(row.getCell(4))).map((code) => employeeByCode.get(code)?.id).filter((id): id is string => Boolean(id));
    if (type === '三人组' && members.length >= 2) base.rules.groups.push({ id: readUuidOrCreate(row.getCell(1)), name: name || '三人组', employeeIds: members });
    else if (type === '互斥对' && members.length === 2) base.rules.exclusionPairs.push({ id: readUuidOrCreate(row.getCell(1)), name: name || '互斥对', employeeIds: [members[0]!, members[1]!] });
    else if (type === '参数' && name in base.rules) {
      (base.rules as unknown as Record<string, number>)[name] = parseInteger(readText(row.getCell(5)));
    }
  });

  const weightsSheet = workbook.getWorksheet('约束优先级');
  base.softConstraints.highestPriority = [];
  weightsSheet?.eachRow((row, number) => {
    if (number === 1) return;
    const key = readText(row.getCell(1)) as SoftConstraintKey;
    if (!['S1', 'S2', 'S3', 'S4', 'S5'].includes(key)) return;
    if (readText(row.getCell(2)) === '是') base.softConstraints.highestPriority.push(key);
    base.softConstraints.weights[key] = parseInteger(readText(row.getCell(3)), 1);
  });

  base.specifiedAssignments = [];
  base.specifiedRestCounts = [];
  const specifiedSheet = workbook.getWorksheet('指定日期');
  specifiedSheet?.eachRow((row, number) => {
    if (number === 1) return;
    const type = readText(row.getCell(4));
    const day = readText(row.getCell(3));
    const id = readUuidOrCreate(row.getCell(1));
    if (type === '指定休息人数') base.specifiedRestCounts.push({ id, date: day, count: parseInteger(readText(row.getCell(5))) });
    else {
      const employee = employeeByCode.get(readText(row.getCell(2)));
      if (!employee) return;
      const state = type === '休息' ? 'OFF' : positionByName.get(readText(row.getCell(5)))?.id;
      if (state) base.specifiedAssignments.push({ id, employeeId: employee.id, date: day, state, locked: true });
    }
  });
  return base;
}

export async function importBoundaryWorkbook(
  filePath: string,
  config: ScheduleConfig,
  targetMonth: string,
): Promise<{ boundary?: BoundaryState; issues: ValidationIssue[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet('排班表');
  if (!sheet) return { issues: [{ code: 'BOUNDARY_SHEET_MISSING', severity: 'ERROR', sourceIds: [], message: '上月文件缺少“排班表”Sheet。' }] };
  const expectedMonth = previousMonth(targetMonth);
  const headers: string[] = [];
  sheet.getRow(2).eachCell((cell, column) => { if (column >= 3) headers[column] = readText(cell); });
  const dateColumns = headers.map((value, column) => ({ value, column })).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.value) && item.value.startsWith(expectedMonth)).slice(-7);
  if (dateColumns.length === 0) return { issues: [{ code: 'BOUNDARY_DATES_MISSING', severity: 'ERROR', sourceIds: [], message: `上月文件中未找到 ${expectedMonth} 的日期列。` }] };
  const positionByName = new Map(config.positions.map((position) => [position.name, position.id]));
  const rowsByCode = new Map<string, ExcelJS.Row>();
  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const code = readText(row.getCell(1));
    if (code) rowsByCode.set(code, row);
  }
  const issues: ValidationIssue[] = [];
  const employees = config.employees.filter((employee) => employee.active).map((employee) => {
    const row = rowsByCode.get(employee.code);
    if (!row) {
      issues.push({ code: 'BOUNDARY_EMPLOYEE_MISSING', severity: 'WARNING', employeeId: employee.id, sourceIds: [], message: `上月排班中未找到 ${employee.name}。` });
      return { employeeId: employee.id, trailingWorkDays: 0, trailingRestDays: 0, recentStates: [] };
    }
    const recentStates = dateColumns.map(({ value, column }) => {
      const label = readText(row.getCell(column));
      return { date: value, state: label === '休息' ? 'OFF' : (positionByName.get(label) ?? 'OFF') };
    });
    let trailingWorkDays = 0;
    let trailingRestDays = 0;
    for (let index = recentStates.length - 1; index >= 0; index -= 1) {
      if (recentStates[index]!.state === 'OFF' && trailingWorkDays === 0) trailingRestDays += 1;
      else if (recentStates[index]!.state !== 'OFF' && trailingRestDays === 0) trailingWorkDays += 1;
      else break;
    }
    return { employeeId: employee.id, trailingWorkDays, trailingRestDays, recentStates };
  });
  return {
    boundary: { schemaVersion: 1, sourceMonth: expectedMonth, complete: issues.length === 0, employees },
    issues,
  };
}

export async function exportConfigurationJson(filePath: string, config: ScheduleConfig): Promise<void> {
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
}

export async function importConfigurationJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

export { TEMPLATE_VERSION };
