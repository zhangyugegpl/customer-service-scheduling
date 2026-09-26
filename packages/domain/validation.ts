import { scheduleConfigSchema } from '../contracts/schemas';
import type {
  Assignment,
  BoundaryState,
  Employee,
  ISODate,
  Position,
  ScheduleConfig,
  ScheduleResult,
  SoftConstraintKey,
  ValidationIssue,
  YearMonth,
} from '../contracts/types';
import { getDateRange, getMonthDates, isDateInMonth, isDateInRange, previousMonth } from './date';
import { computeSoftScores } from './scoring';

function issue(input: Omit<ValidationIssue, 'sourceIds'> & { sourceIds?: string[] }): ValidationIssue {
  return { sourceIds: [], ...input };
}

function quotaFor(position: Position, date: ISODate): number {
  return position.dateQuotaOverrides[date] ?? position.defaultMinQuota;
}

function uniqueDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}

export function validateConfig(
  config: ScheduleConfig,
  targetMonth: YearMonth,
  boundaryState?: BoundaryState,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const parsed = scheduleConfigSchema.safeParse(config);
  if (!parsed.success) {
    for (const problem of parsed.error.issues) {
      issues.push(issue({
        code: 'SCHEMA_INVALID',
        severity: 'ERROR',
        actual: problem.path.join('.'),
        message: `配置格式错误：${problem.path.join('.')} ${problem.message}`,
      }));
    }
    return issues;
  }

  let dates: ISODate[];
  try {
    dates = getMonthDates(targetMonth);
  } catch (error) {
    return [issue({ code: 'TARGET_MONTH_INVALID', severity: 'ERROR', message: String(error) })];
  }

  const employees = config.employees.filter((employee) => employee.active);
  const employeeIds = new Set(config.employees.map((employee) => employee.id));
  const positionIds = new Set(config.positions.map((position) => position.id));

  for (const duplicateId of uniqueDuplicates(config.employees.map((employee) => employee.id))) {
    issues.push(issue({ code: 'EMPLOYEE_ID_DUPLICATE', severity: 'ERROR', sourceIds: [duplicateId], message: '员工 ID 重复。' }));
  }
  for (const duplicateCode of uniqueDuplicates(config.employees.map((employee) => employee.code.trim().toLowerCase()))) {
    issues.push(issue({ code: 'EMPLOYEE_CODE_DUPLICATE', severity: 'ERROR', actual: duplicateCode, message: `员工编号重复：${duplicateCode}` }));
  }
  for (const duplicateId of uniqueDuplicates(config.positions.map((position) => position.id))) {
    issues.push(issue({ code: 'POSITION_ID_DUPLICATE', severity: 'ERROR', sourceIds: [duplicateId], message: '岗位 ID 重复。' }));
  }
  for (const employee of config.employees) {
    const invalidSkills = employee.skillPositionIds.filter((id) => !positionIds.has(id));
    if (invalidSkills.length > 0) {
      issues.push(issue({
        code: 'EMPLOYEE_SKILL_REFERENCE_INVALID',
        severity: 'ERROR',
        employeeId: employee.id,
        sourceIds: invalidSkills,
        message: `${employee.name} 引用了不存在的岗位技能。`,
      }));
    }
    if (employee.monthlyRestDays > dates.length) {
      issues.push(issue({
        code: 'REST_DAYS_EXCEED_MONTH',
        ruleId: 'H3',
        severity: 'ERROR',
        employeeId: employee.id,
        expected: dates.length,
        actual: employee.monthlyRestDays,
        message: `${employee.name} 的月休天数超过目标月天数。`,
      }));
    }
  }

  if (config.rules.weeklyWorkMin > config.rules.weeklyWorkMax) {
    issues.push(issue({ code: 'WEEKLY_RANGE_INVALID', ruleId: 'S5', severity: 'ERROR', message: '每周上班最小值不能大于最大值。' }));
  }
  if (config.rules.workBetweenRestMin > config.rules.workBetweenRestMax) {
    issues.push(issue({ code: 'WORK_BETWEEN_REST_RANGE_INVALID', ruleId: 'S4', severity: 'ERROR', message: '休中休区间最小值不能大于最大值。' }));
  }
  if (config.rules.consecutiveRestSegmentsMin > config.rules.consecutiveRestSegmentsMax) {
    issues.push(issue({ code: 'REST_SEGMENT_RANGE_INVALID', ruleId: 'S3', severity: 'ERROR', message: '连休段区间最小值不能大于最大值。' }));
  }

  for (const group of config.rules.groups) {
    const invalid = group.employeeIds.filter((id) => !employeeIds.has(id));
    if (invalid.length > 0) {
      issues.push(issue({ code: 'GROUP_REFERENCE_INVALID', ruleId: 'H4', severity: 'ERROR', sourceIds: [group.id, ...invalid], message: `三人组“${group.name}”包含不存在的员工。` }));
    }
  }
  for (const pair of config.rules.exclusionPairs) {
    const invalid = pair.employeeIds.filter((id) => !employeeIds.has(id));
    if (invalid.length > 0 || pair.employeeIds[0] === pair.employeeIds[1]) {
      issues.push(issue({ code: 'PAIR_REFERENCE_INVALID', ruleId: 'H5', severity: 'ERROR', sourceIds: [pair.id, ...invalid], message: `互斥对“${pair.name}”配置无效。` }));
    }
  }

  for (const date of dates) {
    const quotaSum = config.positions.reduce((sum, position) => sum + quotaFor(position, date), 0);
    if (quotaSum > employees.length) {
      issues.push(issue({
        code: 'DAILY_CAPACITY_INSUFFICIENT',
        ruleId: 'H2',
        severity: 'ERROR',
        date,
        expected: quotaSum,
        actual: employees.length,
        message: `${date} 的岗位最低配额合计 ${quotaSum}，超过在职员工数 ${employees.length}。`,
      }));
    }
    for (const position of config.positions) {
      const eligible = employees.filter((employee) => employee.skillPositionIds.includes(position.id)).length;
      const quota = quotaFor(position, date);
      if (eligible < quota) {
        issues.push(issue({
          code: 'POSITION_SKILL_CAPACITY_INSUFFICIENT',
          ruleId: 'H2',
          severity: 'ERROR',
          date,
          expected: quota,
          actual: eligible,
          sourceIds: [position.id],
          message: `${date} 的“${position.name}”最低配额为 ${quota}，但仅 ${eligible} 人具备技能。`,
        }));
      }
    }
  }

  const totalRestDemand = employees.reduce((sum, employee) => sum + employee.monthlyRestDays, 0);
  const totalRestCapacity = dates.reduce((sum, date) => {
    const minimumWorkers = config.positions.reduce((quotaSum, position) => quotaSum + quotaFor(position, date), 0);
    return sum + Math.max(0, employees.length - minimumWorkers);
  }, 0);
  if (totalRestDemand > totalRestCapacity) {
    issues.push(issue({
      code: 'MONTHLY_REST_CAPACITY_INSUFFICIENT',
      ruleId: 'H2',
      severity: 'ERROR',
      expected: totalRestDemand,
      actual: totalRestCapacity,
      message: `全员月休需求 ${totalRestDemand} 人天，超过岗位最低配额下最多可休的 ${totalRestCapacity} 人天。`,
    }));
  }

  const specifiedByEmployeeDate = new Map<string, typeof config.specifiedAssignments>();
  for (const assignment of config.specifiedAssignments) {
    const employee = config.employees.find((candidate) => candidate.id === assignment.employeeId);
    if (!employee) {
      issues.push(issue({ code: 'SPECIFIED_EMPLOYEE_NOT_FOUND', severity: 'ERROR', date: assignment.date, sourceIds: [assignment.id, assignment.employeeId], message: '指定日期引用了不存在的员工。' }));
      continue;
    }
    let lockedDates: ISODate[];
    try {
      lockedDates = getDateRange(assignment.date, assignment.endDate ?? assignment.date);
    } catch (error) {
      issues.push(issue({ code: 'SPECIFIED_DATE_RANGE_INVALID', severity: 'ERROR', employeeId: employee.id, date: assignment.date, sourceIds: [assignment.id], message: `指定日期范围无效：${String(error)}` }));
      continue;
    }
    for (const date of lockedDates) {
      const key = `${assignment.employeeId}|${date}`;
      const values = specifiedByEmployeeDate.get(key) ?? [];
      values.push(assignment);
      specifiedByEmployeeDate.set(key, values);
      if (!isDateInMonth(date, targetMonth)) {
        issues.push(issue({ code: 'SPECIFIED_DATE_OUTSIDE_MONTH', severity: 'ERROR', employeeId: employee.id, date, sourceIds: [assignment.id], message: `指定日期 ${date} 不属于目标月。` }));
      }
    }
    if (assignment.state !== 'OFF') {
      const position = config.positions.find((candidate) => candidate.id === assignment.state);
      if (!position) {
        issues.push(issue({ code: 'SPECIFIED_POSITION_NOT_FOUND', ruleId: 'H7', severity: 'ERROR', employeeId: employee.id, date: assignment.date, sourceIds: [assignment.id], message: '指定日期引用了不存在的岗位。' }));
      } else if (!employee.skillPositionIds.includes(position.id)) {
        issues.push(issue({ code: 'SPECIFIED_POSITION_SKILL_MISSING', ruleId: position.name.includes('审单') ? 'H9' : 'H7', severity: 'ERROR', employeeId: employee.id, date: assignment.date, sourceIds: [assignment.id, position.id], message: `${employee.name} 不具备“${position.name}”技能，不能锁定该岗位。` }));
      }
    }
  }
  for (const [key, values] of specifiedByEmployeeDate) {
    if (new Set(values.map((value) => value.state)).size > 1) {
      const first = values[0]!;
      issues.push(issue({ code: 'SPECIFIED_ASSIGNMENT_CONFLICT', severity: 'ERROR', employeeId: first.employeeId, date: key.slice(key.indexOf('|') + 1), sourceIds: values.map((value) => value.id), message: '同一员工同一天存在互相矛盾的指定状态。' }));
    }
  }

  const restCountsByDate = new Map<string, typeof config.specifiedRestCounts>();
  for (const value of config.specifiedRestCounts) {
    let specifiedDates: ISODate[];
    try {
      specifiedDates = getDateRange(value.date, value.endDate ?? value.date);
    } catch (error) {
      issues.push(issue({ code: 'SPECIFIED_REST_DATE_RANGE_INVALID', ruleId: 'H8', severity: 'ERROR', date: value.date, sourceIds: [value.id], message: `指定休息人数日期范围无效：${String(error)}` }));
      continue;
    }
    for (const date of specifiedDates) {
      const values = restCountsByDate.get(date) ?? [];
      values.push(value);
      restCountsByDate.set(date, values);
      if (!isDateInMonth(date, targetMonth)) {
        issues.push(issue({ code: 'SPECIFIED_REST_DATE_OUTSIDE_MONTH', ruleId: 'H8', severity: 'ERROR', date, sourceIds: [value.id], message: `指定休息人数日期 ${date} 不属于目标月。` }));
        continue;
      }
      const fixedOff = config.specifiedAssignments.filter((assignment) => assignment.state === 'OFF' && isDateInRange(date, assignment.date, assignment.endDate ?? assignment.date)).length;
      const minWorkers = config.positions.reduce((sum, position) => sum + quotaFor(position, date), 0);
      const maxOff = Math.max(0, employees.length - minWorkers);
      if (value.count < fixedOff || value.count > maxOff) {
        issues.push(issue({ code: 'SPECIFIED_REST_COUNT_IMPOSSIBLE', ruleId: 'H8', severity: 'ERROR', date, expected: `${fixedOff}～${maxOff}`, actual: value.count, sourceIds: [value.id], message: `${date} 指定休息 ${value.count} 人，不在可行范围 ${fixedOff}～${maxOff}。` }));
      }
    }
  }
  for (const [date, values] of restCountsByDate) {
    if (new Set(values.map((value) => value.count)).size > 1) {
      issues.push(issue({ code: 'SPECIFIED_REST_COUNT_CONFLICT', ruleId: 'H8', severity: 'ERROR', date, sourceIds: values.map((value) => value.id), message: '同一日期配置了不同的指定休息人数。' }));
    }
  }

  for (const date of dates) {
    const fixedOffIds = new Set(config.specifiedAssignments.filter((assignment) => assignment.state === 'OFF' && isDateInRange(date, assignment.date, assignment.endDate ?? assignment.date)).map((assignment) => assignment.employeeId));
    for (const group of config.rules.groups) {
      const off = group.employeeIds.filter((id) => fixedOffIds.has(id));
      if (off.length > 1) {
        issues.push(issue({ code: 'GROUP_FIXED_REST_CONFLICT', ruleId: 'H4', severity: 'ERROR', date, sourceIds: [group.id, ...off], message: `${date} 的指定休息违反三人组“${group.name}”。` }));
      }
    }
    for (const pair of config.rules.exclusionPairs) {
      if (pair.employeeIds.every((id) => fixedOffIds.has(id))) {
        issues.push(issue({ code: 'PAIR_FIXED_REST_CONFLICT', ruleId: 'H5', severity: 'ERROR', date, sourceIds: [pair.id, ...pair.employeeIds], message: `${date} 的指定休息违反互斥对“${pair.name}”。` }));
      }
    }
  }

  if (!boundaryState) {
    issues.push(issue({ code: 'BOUNDARY_MISSING', severity: 'WARNING', message: '未提供上月边界数据，跨月规则无法完整校验。' }));
  } else if (boundaryState.sourceMonth !== previousMonth(targetMonth)) {
    issues.push(issue({ code: 'BOUNDARY_MONTH_MISMATCH', severity: 'ERROR', actual: boundaryState.sourceMonth, expected: previousMonth(targetMonth), message: `边界数据月份应为 ${previousMonth(targetMonth)}。` }));
  } else if (!boundaryState.complete) {
    issues.push(issue({ code: 'BOUNDARY_INCOMPLETE', severity: 'WARNING', message: '上月边界数据不完整，跨月规则将降级校验。' }));
  }

  return issues;
}

function assignmentKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`;
}

export function validateSchedule(config: ScheduleConfig, schedule: Pick<ScheduleResult, 'targetMonth' | 'assignments'>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dates = getMonthDates(schedule.targetMonth);
  const dateSet = new Set(dates);
  const employees = config.employees.filter((employee) => employee.active);
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const positionMap = new Map(config.positions.map((position) => [position.id, position]));
  const valuesByKey = new Map<string, Assignment[]>();

  for (const assignment of schedule.assignments) {
    const key = assignmentKey(assignment.employeeId, assignment.date);
    const values = valuesByKey.get(key) ?? [];
    values.push(assignment);
    valuesByKey.set(key, values);
    if (!employeeMap.has(assignment.employeeId) || !dateSet.has(assignment.date)) {
      issues.push(issue({ code: 'ASSIGNMENT_OUT_OF_SCOPE', ruleId: 'H1', severity: 'ERROR', employeeId: assignment.employeeId, date: assignment.date, message: '排班包含目标范围之外的员工或日期。' }));
    }
  }

  for (const employee of employees) {
    for (const date of dates) {
      const values = valuesByKey.get(assignmentKey(employee.id, date)) ?? [];
      if (values.length !== 1) {
        issues.push(issue({ code: 'ASSIGNMENT_COUNT_INVALID', ruleId: 'H1', severity: 'ERROR', employeeId: employee.id, date, expected: 1, actual: values.length, message: `${employee.name} 在 ${date} 必须且只能有一个状态。` }));
        continue;
      }
      const state = values[0]!.state;
      if (state !== 'OFF') {
        const position = positionMap.get(state);
        if (!position) {
          issues.push(issue({ code: 'ASSIGNMENT_POSITION_INVALID', ruleId: 'H2', severity: 'ERROR', employeeId: employee.id, date, actual: state, message: `${employee.name} 在 ${date} 被安排到不存在的岗位。` }));
        } else if (!employee.skillPositionIds.includes(position.id)) {
          issues.push(issue({ code: 'ASSIGNMENT_SKILL_MISSING', ruleId: 'H2', severity: 'ERROR', employeeId: employee.id, date, sourceIds: [position.id], message: `${employee.name} 不具备“${position.name}”技能。` }));
        }
      }
    }
  }

  for (const date of dates) {
    const values = schedule.assignments.filter((assignment) => assignment.date === date);
    for (const position of config.positions) {
      const actual = values.filter((assignment) => assignment.state === position.id).length;
      const expected = quotaFor(position, date);
      if (actual < expected) {
        issues.push(issue({ code: 'POSITION_QUOTA_UNMET', ruleId: 'H2', severity: 'ERROR', date, expected, actual, sourceIds: [position.id], message: `${date} 的“${position.name}”人数 ${actual}，低于最低配额 ${expected}。` }));
      }
    }
    const offIds = new Set(values.filter((assignment) => assignment.state === 'OFF').map((assignment) => assignment.employeeId));
    for (const group of config.rules.groups) {
      const actual = group.employeeIds.filter((id) => offIds.has(id)).length;
      if (actual > 1) {
        issues.push(issue({ code: 'GROUP_REST_VIOLATION', ruleId: 'H4', severity: 'ERROR', date, expected: 1, actual, sourceIds: [group.id], message: `${date} 三人组“${group.name}”同时休息 ${actual} 人。` }));
      }
    }
    for (const pair of config.rules.exclusionPairs) {
      if (pair.employeeIds.every((id) => offIds.has(id))) {
        issues.push(issue({ code: 'PAIR_REST_VIOLATION', ruleId: 'H5', severity: 'ERROR', date, sourceIds: [pair.id], message: `${date} 互斥对“${pair.name}”同时休息。` }));
      }
    }
    const specified = config.specifiedRestCounts.find((value) => isDateInRange(date, value.date, value.endDate ?? value.date));
    if (specified && offIds.size !== specified.count) {
      issues.push(issue({ code: 'SPECIFIED_REST_COUNT_VIOLATION', ruleId: 'H8', severity: 'ERROR', date, expected: specified.count, actual: offIds.size, sourceIds: [specified.id], message: `${date} 实际休息 ${offIds.size} 人，与指定 ${specified.count} 人不符。` }));
    }
  }

  for (const employee of employees) {
    const actual = schedule.assignments.filter((assignment) => assignment.employeeId === employee.id && assignment.state === 'OFF').length;
    if (actual !== employee.monthlyRestDays) {
      issues.push(issue({ code: 'MONTHLY_REST_DAYS_VIOLATION', ruleId: 'H3', severity: 'ERROR', employeeId: employee.id, expected: employee.monthlyRestDays, actual, message: `${employee.name} 实际休息 ${actual} 天，应休 ${employee.monthlyRestDays} 天。` }));
    }
  }

  for (const locked of config.specifiedAssignments) {
    let lockedDates: ISODate[] = [];
    try {
      lockedDates = getDateRange(locked.date, locked.endDate ?? locked.date);
    } catch {
      continue;
    }
    for (const date of lockedDates) {
      const actual = valuesByKey.get(assignmentKey(locked.employeeId, date))?.[0]?.state;
      if (actual !== locked.state) {
        const position = locked.state === 'OFF' ? undefined : positionMap.get(locked.state);
        issues.push(issue({ code: 'LOCKED_ASSIGNMENT_VIOLATION', ruleId: locked.state === 'OFF' ? 'H6' : position?.name.includes('审单') ? 'H9' : 'H7', severity: 'ERROR', employeeId: locked.employeeId, date, expected: locked.state, actual: actual ?? '缺失', sourceIds: [locked.id], message: `${date} 的锁定状态未满足。` }));
      }
    }
  }

  const hardRuleLabels: Record<SoftConstraintKey, string> = {
    S1: '倒班规避',
    S2: '中班均匀',
    S3: '连续双休',
    S4: '休中休间隔',
    S5: '每周上班天数',
  };
  for (const score of computeSoftScores(config, schedule.assignments)) {
    if ((config.softConstraints.modes?.[score.ruleId] ?? 'SOFT') !== 'HARD' || score.violations === 0) continue;
    const expected = score.ruleId === 'S2' ? `极差 ≤ ${config.rules.middleShiftMaxRange ?? 3}` : '违规数为 0';
    const actual = score.ruleId === 'S2' ? `极差 ${(config.rules.middleShiftMaxRange ?? 3) + score.violations}` : score.violations;
    issues.push(issue({
      code: `${score.ruleId}_HARD_CONSTRAINT_VIOLATION`,
      ruleId: score.ruleId,
      severity: 'ERROR',
      expected,
      actual,
      message: `${hardRuleLabels[score.ruleId]}已配置为“必须满足”，当前结果未达到要求。`,
    }));
  }

  return issues;
}

export function activeEmployees(config: ScheduleConfig): Employee[] {
  return config.employees.filter((employee) => employee.active);
}

export { quotaFor };
