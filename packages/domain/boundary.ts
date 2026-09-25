import type { Assignment, BoundaryState, ScheduleConfig, ScheduleResult } from '../contracts/types';
import { getMonthDates } from './date';

export function buildBoundaryState(config: ScheduleConfig, schedule: Pick<ScheduleResult, 'id' | 'targetMonth' | 'assignments'>): BoundaryState {
  const dates = getMonthDates(schedule.targetMonth);
  const recentDates = dates.slice(-7);
  const byEmployee = new Map<string, Assignment[]>();
  for (const assignment of schedule.assignments) {
    const values = byEmployee.get(assignment.employeeId) ?? [];
    values.push(assignment);
    byEmployee.set(assignment.employeeId, values);
  }

  return {
    schemaVersion: 1,
    sourceMonth: schedule.targetMonth,
    sourceScheduleId: schedule.id,
    complete: true,
    employees: config.employees.filter((employee) => employee.active).map((employee) => {
      const values = (byEmployee.get(employee.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      let trailingWorkDays = 0;
      let trailingRestDays = 0;
      for (let index = values.length - 1; index >= 0; index -= 1) {
        const state = values[index]!.state;
        if (state === 'OFF' && trailingWorkDays === 0) trailingRestDays += 1;
        else if (state !== 'OFF' && trailingRestDays === 0) trailingWorkDays += 1;
        else break;
      }
      return {
        employeeId: employee.id,
        trailingWorkDays,
        trailingRestDays,
        recentStates: values.filter((value) => recentDates.includes(value.date)).map(({ date, state }) => ({ date, state })),
      };
    }),
  };
}

