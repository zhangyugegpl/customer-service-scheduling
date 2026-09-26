import type { Assignment, BoundaryState, ScheduleConfig, SoftScore } from '../contracts/types';
import { getMonthDates, mondayOfWeek } from './date';

function assignmentsForEmployee(assignments: Assignment[], employeeId: string, dates: string[]): Assignment[] {
  const byDate = new Map(assignments.filter((assignment) => assignment.employeeId === employeeId).map((assignment) => [assignment.date, assignment]));
  return dates.map((date) => byDate.get(date)).filter((value): value is Assignment => Boolean(value));
}

function countRestSegments(states: string[]): number {
  let segments = 0;
  for (let index = 0; index < states.length - 1; index += 1) {
    if (states[index] === 'OFF' && states[index + 1] === 'OFF' && (index === 0 || states[index - 1] !== 'OFF')) segments += 1;
  }
  return segments;
}

export function computeSoftScores(config: ScheduleConfig, assignments: Assignment[], boundary?: BoundaryState): SoftScore[] {
  const targetMonth = assignments[0]?.date.slice(0, 7) ?? '';
  if (!targetMonth) return [];
  const dates = getMonthDates(targetMonth);
  const active = config.employees.filter((employee) => employee.active);
  let switches = 0;
  let restSegmentViolations = 0;
  let workGapViolations = 0;
  let weeklyViolations = 0;

  for (const employee of active) {
    const current = assignmentsForEmployee(assignments, employee.id, dates);
    const previous = boundary?.employees.find((value) => value.employeeId === employee.id)?.recentStates ?? [];
    const states = [...previous.slice(-7), ...current].map((value) => value.state);
    for (let index = 1; index < states.length; index += 1) {
      const before = states[index - 1]!;
      const after = states[index]!;
      if (before !== 'OFF' && after !== 'OFF' && before !== after) switches += 1;
    }

    const segments = countRestSegments(states);
    if (segments < config.rules.consecutiveRestSegmentsMin) restSegmentViolations += config.rules.consecutiveRestSegmentsMin - segments;
    if (segments > config.rules.consecutiveRestSegmentsMax) restSegmentViolations += segments - config.rules.consecutiveRestSegmentsMax;

    let workRun = 0;
    let hasSeenRest = false;
    for (const state of states) {
      if (state === 'OFF') {
        if (hasSeenRest && workRun > 0) {
          if (workRun < config.rules.workBetweenRestMin) workGapViolations += config.rules.workBetweenRestMin - workRun;
          if (workRun > config.rules.workBetweenRestMax) workGapViolations += workRun - config.rules.workBetweenRestMax;
        }
        hasSeenRest = true;
        workRun = 0;
      } else if (hasSeenRest) {
        workRun += 1;
      }
    }

    const weekMap = new Map<string, string[]>();
    for (const assignment of current) {
      const week = mondayOfWeek(assignment.date);
      const values = weekMap.get(week) ?? [];
      values.push(assignment.state);
      weekMap.set(week, values);
    }
    for (const values of weekMap.values()) {
      if (values.length !== 7) continue;
      const workDays = values.filter((state) => state !== 'OFF').length;
      if (workDays < config.rules.weeklyWorkMin) weeklyViolations += config.rules.weeklyWorkMin - workDays;
      if (workDays > config.rules.weeklyWorkMax) weeklyViolations += workDays - config.rules.weeklyWorkMax;
    }
  }

  const middle = config.positions.find((position) => position.name.includes('中'));
  let middleRange = 0;
  if (middle) {
    const eligible = active.filter((employee) => employee.skillPositionIds.includes(middle.id));
    const counts = eligible.map((employee) => assignments.filter((assignment) => assignment.employeeId === employee.id && assignment.state === middle.id).length);
    if (counts.length > 0) middleRange = Math.max(...counts) - Math.min(...counts);
  }

  const middleShiftMaxRange = config.rules.middleShiftMaxRange ?? 3;
  return [
    { ruleId: 'S1', score: switches * config.softConstraints.weights.S1, violations: switches },
    { ruleId: 'S2', score: Math.max(0, middleRange - middleShiftMaxRange) * config.softConstraints.weights.S2, violations: Math.max(0, middleRange - middleShiftMaxRange) },
    { ruleId: 'S3', score: restSegmentViolations * config.softConstraints.weights.S3, violations: restSegmentViolations },
    { ruleId: 'S4', score: workGapViolations * config.softConstraints.weights.S4, violations: workGapViolations },
    { ruleId: 'S5', score: weeklyViolations * config.softConstraints.weights.S5, violations: weeklyViolations },
  ];
}
