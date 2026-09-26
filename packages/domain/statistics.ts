import type { Assignment, AssignmentState, EmployeeId, ISODate, PositionId } from '../contracts/types';

export interface ScheduleStatistics {
  byEmployee: Record<EmployeeId, Record<string, number>>;
  byDate: Record<ISODate, Record<string, number>>;
}

export function buildScheduleStatistics(
  assignments: Assignment[],
  employeeIds: EmployeeId[],
  dates: ISODate[],
  positionIds: PositionId[],
): ScheduleStatistics {
  const states: AssignmentState[] = ['OFF', ...positionIds];
  const byEmployee = Object.fromEntries(employeeIds.map((employeeId) => [
    employeeId,
    Object.fromEntries(states.map((state) => [state, 0])),
  ]));
  const byDate = Object.fromEntries(dates.map((date) => [
    date,
    Object.fromEntries(states.map((state) => [state, 0])),
  ]));
  const employeeSet = new Set(employeeIds);
  const dateSet = new Set(dates);
  const stateSet = new Set<AssignmentState>(states);

  for (const assignment of assignments) {
    if (!employeeSet.has(assignment.employeeId) || !dateSet.has(assignment.date) || !stateSet.has(assignment.state)) continue;
    byEmployee[assignment.employeeId]![assignment.state] = (byEmployee[assignment.employeeId]![assignment.state] ?? 0) + 1;
    byDate[assignment.date]![assignment.state] = (byDate[assignment.date]![assignment.state] ?? 0) + 1;
  }
  return { byEmployee, byDate };
}
