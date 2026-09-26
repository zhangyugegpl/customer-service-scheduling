import { describe, expect, it } from 'vitest';
import type { Assignment } from '../../packages/contracts/types';
import { buildScheduleStatistics } from '../../packages/domain/statistics';

describe('排班统计', () => {
  it('同时生成员工右侧岗位统计和日期底部状态统计', () => {
    const employees = ['employee-1', 'employee-2'];
    const dates = ['2026-10-01', '2026-10-02'];
    const positions = ['early', 'middle'];
    const assignments: Assignment[] = [
      { employeeId: employees[0]!, date: dates[0]!, state: 'early' },
      { employeeId: employees[0]!, date: dates[1]!, state: 'OFF' },
      { employeeId: employees[1]!, date: dates[0]!, state: 'middle' },
      { employeeId: employees[1]!, date: dates[1]!, state: 'early' },
    ];

    const statistics = buildScheduleStatistics(assignments, employees, dates, positions);

    expect(statistics.byEmployee['employee-1']).toMatchObject({ OFF: 1, early: 1, middle: 0 });
    expect(statistics.byEmployee['employee-2']).toMatchObject({ OFF: 0, early: 1, middle: 1 });
    expect(statistics.byDate['2026-10-01']).toMatchObject({ OFF: 0, early: 1, middle: 1 });
    expect(statistics.byDate['2026-10-02']).toMatchObject({ OFF: 1, early: 1, middle: 0 });
  });
});
