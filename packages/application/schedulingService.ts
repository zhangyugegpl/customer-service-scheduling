import { randomUUID } from 'node:crypto';
import type {
  GenerateScheduleRequest,
  ScheduleResult,
  ValidationIssue,
} from '../contracts/types';
import { buildBoundaryState, computeSoftScores, validateConfig, validateSchedule } from '../domain';
import type { SolverClient } from '../solver-client/client';

function now(): string {
  return new Date().toISOString();
}

function createEmptyResult(
  request: GenerateScheduleRequest,
  status: ScheduleResult['status'],
  issues: ValidationIssue[],
  metricsStatus: string,
): ScheduleResult {
  const timestamp = now();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    targetMonth: request.targetMonth,
    createdAt: timestamp,
    updatedAt: timestamp,
    status,
    solverVersion: 'unavailable',
    randomSeed: request.randomSeed ?? 1,
    assignments: [],
    issues,
    softScores: [],
    metrics: { status: metricsStatus, wallTimeMs: 0 },
    crossMonthVerified: request.boundaryState?.complete === true,
    manualChanges: [],
    exportRecords: [],
  };
}

export class SchedulingService {
  constructor(private readonly solver: SolverClient) {}

  async generate(request: GenerateScheduleRequest): Promise<ScheduleResult> {
    const preflightIssues = validateConfig(request.config, request.targetMonth, request.boundaryState);
    const blocking = preflightIssues.filter((value) => value.severity === 'ERROR');
    if (blocking.length > 0) return createEmptyResult(request, 'INFEASIBLE', preflightIssues, 'PRECHECK_FAILED');

    const raw = await this.solver.solve({
      ...request,
      timeLimitSeconds: request.timeLimitSeconds ?? 3,
      randomSeed: request.randomSeed ?? 1,
    });
    if (raw.status === 'TIMEOUT') {
      return createEmptyResult(request, 'TIMEOUT', [
        ...preflightIssues,
        {
          code: 'SOLVER_TIMEOUT',
          severity: 'ERROR',
          sourceIds: [],
          message: '求解器在时限内未找到可行方案，请调整约束或增加求解时限。',
        },
      ], raw.solverStatus);
    }
    if (raw.status === 'INFEASIBLE') {
      return createEmptyResult(request, 'INFEASIBLE', [
        ...preflightIssues,
        {
          code: 'SOLVER_INFEASIBLE',
          severity: 'ERROR',
          sourceIds: [],
          message: '严格模型与有例外模型均无法形成完整排班。',
        },
      ], raw.solverStatus);
    }

    const timestamp = now();
    const provisional: ScheduleResult = {
      schemaVersion: 1,
      id: randomUUID(),
      targetMonth: request.targetMonth,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: raw.status === 'EXCEPTION' ? 'EXCEPTION' : 'PUBLISHABLE',
      solverVersion: raw.solverVersion,
      randomSeed: request.randomSeed ?? 1,
      assignments: raw.assignments,
      issues: [],
      softScores: [],
      metrics: raw.metrics,
      crossMonthVerified: request.boundaryState?.complete === true,
      manualChanges: [],
      exportRecords: [],
    };
    const validationIssues = validateSchedule(request.config, provisional);
    provisional.issues = [...preflightIssues, ...validationIssues];
    provisional.status = validationIssues.some((value) => value.severity === 'ERROR') ? 'EXCEPTION' : provisional.status;
    provisional.softScores = computeSoftScores(request.config, provisional.assignments, request.boundaryState);
    provisional.boundaryState = buildBoundaryState(request.config, provisional);
    return provisional;
  }
}

