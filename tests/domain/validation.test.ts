import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../packages/contracts/defaultConfig';
import type { Assignment, ScheduleResult } from '../../packages/contracts/types';
import { getMonthDates, validateConfig, validateSchedule } from '../../packages/domain';

describe('配置预检查', () => {
  it('默认配置仅提示缺少跨月边界，不产生阻断错误', () => {
    const config = createDefaultConfig(new Date('2026-09-25T00:00:00.000Z'));
    const issues = validateConfig(config, '2026-10');
    expect(issues.filter((value) => value.severity === 'ERROR')).toEqual([]);
    expect(issues.some((value) => value.code === 'BOUNDARY_MISSING')).toBe(true);
  });

  it('最低岗位配额超过在职人数时返回容量错误', () => {
    const config = createDefaultConfig();
    config.positions[0]!.defaultMinQuota = 20;
    const issues = validateConfig(config, '2026-10');
    expect(issues.some((value) => value.code === 'DAILY_CAPACITY_INSUFFICIENT')).toBe(true);
  });

  it('同一员工同一天存在矛盾锁定时阻止生成', () => {
    const config = createDefaultConfig();
    const employee = config.employees[0]!;
    config.specifiedAssignments.push(
      { id: '10000000-0000-4000-8000-000000000001', employeeId: employee.id, date: '2026-10-02', state: 'OFF', locked: true },
      { id: '10000000-0000-4000-8000-000000000002', employeeId: employee.id, date: '2026-10-02', state: config.positions[0]!.id, locked: true },
    );
    const issues = validateConfig(config, '2026-10');
    expect(issues.some((value) => value.code === 'SPECIFIED_ASSIGNMENT_CONFLICT')).toBe(true);
  });
});

describe('排班结果校验', () => {
  it('接受满足唯一状态、岗位配额、技能和月休的排班', () => {
    const config = createDefaultConfig();
    config.rules.groups = [];
    config.rules.exclusionPairs = [];
    for (const employee of config.employees) {
      employee.monthlyRestDays = 0;
      employee.skillPositionIds = config.positions.map((position) => position.id);
    }
    const dates = getMonthDates('2026-10');
    const assignments: Assignment[] = [];
    for (const date of dates) {
      config.employees.forEach((employee, index) => {
        const position = index < 3
          ? config.positions[0]!
          : index < 5
            ? config.positions[1]!
            : index === 5
              ? config.positions[2]!
              : config.positions[3]!;
        assignments.push({ employeeId: employee.id, date, state: position.id });
      });
    }
    expect(validateSchedule(config, { targetMonth: '2026-10', assignments })).toEqual([]);
  });

  it('识别员工同日状态缺失', () => {
    const config = createDefaultConfig();
    const schedule = { targetMonth: '2026-10', assignments: [] } as Pick<ScheduleResult, 'targetMonth' | 'assignments'>;
    const issues = validateSchedule(config, schedule);
    expect(issues.some((value) => value.code === 'ASSIGNMENT_COUNT_INVALID')).toBe(true);
  });
});
