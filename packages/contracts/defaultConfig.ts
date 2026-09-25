import type { ScheduleConfig } from './types';

const POSITION_IDS = {
  early: '00000000-0000-4000-8000-000000000101',
  middle: '00000000-0000-4000-8000-000000000102',
  review: '00000000-0000-4000-8000-000000000103',
  backoffice: '00000000-0000-4000-8000-000000000104',
} as const;

const EMPLOYEE_IDS = Array.from(
  { length: 9 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

export function createDefaultConfig(now = new Date()): ScheduleConfig {
  const allBaseSkills = [POSITION_IDS.early, POSITION_IDS.middle, POSITION_IDS.backoffice];
  return {
    schemaVersion: 1,
    templateVersion: '1.0.0',
    id: '00000000-0000-4000-8000-000000000001',
    name: '默认客服组',
    updatedAt: now.toISOString(),
    positions: [
      { id: POSITION_IDS.early, name: '早班', color: '#D9EAF7', defaultMinQuota: 3, dateQuotaOverrides: {} },
      { id: POSITION_IDS.middle, name: '中班', color: '#FFE5B4', defaultMinQuota: 2, dateQuotaOverrides: {} },
      { id: POSITION_IDS.review, name: '审单', color: '#DCCEF8', defaultMinQuota: 1, dateQuotaOverrides: {} },
      { id: POSITION_IDS.backoffice, name: '后台', color: '#D8EFD3', defaultMinQuota: 1, dateQuotaOverrides: {} },
    ],
    employees: EMPLOYEE_IDS.map((id, index) => ({
      id,
      code: `CS${String(index + 1).padStart(3, '0')}`,
      name: `客服${String(index + 1).padStart(2, '0')}`,
      active: true,
      skillPositionIds: index < 4 ? [...allBaseSkills, POSITION_IDS.review] : allBaseSkills,
      monthlyRestDays: 6,
    })),
    rules: {
      groups: [
        {
          id: '00000000-0000-4000-8000-000000000201',
          name: '互备组 A',
          employeeIds: [EMPLOYEE_IDS[0]!, EMPLOYEE_IDS[1]!, EMPLOYEE_IDS[2]!],
        },
      ],
      exclusionPairs: [
        {
          id: '00000000-0000-4000-8000-000000000202',
          name: '关键岗位互斥对',
          employeeIds: [EMPLOYEE_IDS[3]!, EMPLOYEE_IDS[4]!],
        },
      ],
      weeklyWorkMin: 3,
      weeklyWorkMax: 6,
      preferredWeeklyWorkDays: 6,
      consecutiveRestSegmentsMin: 1,
      consecutiveRestSegmentsMax: 2,
      workBetweenRestMin: 3,
      workBetweenRestMax: 6,
    },
    softConstraints: {
      highestPriority: ['S1'],
      weights: { S1: 10, S2: 8, S3: 5, S4: 5, S5: 2 },
    },
    specifiedAssignments: [],
    specifiedRestCounts: [],
  };
}

export { EMPLOYEE_IDS, POSITION_IDS };

