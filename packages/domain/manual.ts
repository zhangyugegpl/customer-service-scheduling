import type { AssignmentState, ScheduleConfig, ScheduleResult } from '../contracts/types';
import { computeSoftScores } from './scoring';
import { validateSchedule } from './validation';

export function forceAssignmentChange(
  config: ScheduleConfig,
  schedule: ScheduleResult,
  employeeId: string,
  date: string,
  state: AssignmentState,
  reason?: string,
): ScheduleResult {
  const existing = schedule.assignments.find((assignment) => assignment.employeeId === employeeId && assignment.date === date);
  if (!existing) throw new Error('未找到要调整的排班单元格。');
  const locked = config.specifiedAssignments.find((assignment) => assignment.employeeId === employeeId && assignment.date === date);
  if (locked) throw new Error('该单元格已被指定日期规则锁定，请先解除对应规则。');
  const assignments = schedule.assignments.map((assignment) => assignment === existing ? { ...assignment, state } : assignment);
  const issues = validateSchedule(config, { targetMonth: schedule.targetMonth, assignments });
  return {
    ...schedule,
    assignments,
    issues,
    status: issues.some((value) => value.severity === 'ERROR') ? 'EXCEPTION' : 'PUBLISHABLE',
    updatedAt: new Date().toISOString(),
    softScores: computeSoftScores(config, assignments, schedule.boundaryState),
    manualChanges: [
      ...schedule.manualChanges,
      {
        id: crypto.randomUUID(),
        changedAt: new Date().toISOString(),
        employeeId,
        date,
        before: existing.state,
        after: state,
        mode: 'FORCE',
        reason,
      },
    ],
  };
}
