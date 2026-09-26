export type UUID = string;
export type ISODate = string;
export type YearMonth = string;
export type PositionId = UUID;
export type EmployeeId = UUID;
export type AssignmentState = 'OFF' | PositionId;
export type ScheduleStatus = 'PUBLISHABLE' | 'EXCEPTION' | 'INFEASIBLE' | 'TIMEOUT';
export type IssueSeverity = 'ERROR' | 'WARNING' | 'INFO';
export type SoftConstraintKey = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
export type RuleId =
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'H6'
  | 'H7'
  | 'H8'
  | 'H9'
  | SoftConstraintKey;

export interface Employee {
  id: EmployeeId;
  code: string;
  name: string;
  active: boolean;
  skillPositionIds: PositionId[];
  monthlyRestDays: number;
}

export interface Position {
  id: PositionId;
  name: string;
  color: string;
  defaultMinQuota: number;
  dateQuotaOverrides: Record<ISODate, number>;
}

export interface EmployeeGroupRule {
  id: UUID;
  name: string;
  employeeIds: EmployeeId[];
}

export interface ExclusionPairRule {
  id: UUID;
  name: string;
  employeeIds: [EmployeeId, EmployeeId];
}

export interface RulesConfig {
  groups: EmployeeGroupRule[];
  exclusionPairs: ExclusionPairRule[];
  weeklyWorkMin: number;
  weeklyWorkMax: number;
  preferredWeeklyWorkDays: number;
  consecutiveRestSegmentsMin: number;
  consecutiveRestSegmentsMax: number;
  workBetweenRestMin: number;
  workBetweenRestMax: number;
}

export interface SoftConstraintWeights {
  highestPriority: SoftConstraintKey[];
  weights: Record<SoftConstraintKey, number>;
}

export interface SpecifiedAssignment {
  id: UUID;
  employeeId: EmployeeId;
  date: ISODate;
  endDate?: ISODate;
  state: AssignmentState;
  locked: true;
}

export interface SpecifiedRestCount {
  id: UUID;
  date: ISODate;
  endDate?: ISODate;
  count: number;
}

export interface ScheduleConfig {
  schemaVersion: 1;
  templateVersion: string;
  id: UUID;
  name: string;
  updatedAt: string;
  employees: Employee[];
  positions: Position[];
  rules: RulesConfig;
  softConstraints: SoftConstraintWeights;
  specifiedAssignments: SpecifiedAssignment[];
  specifiedRestCounts: SpecifiedRestCount[];
}

export interface BoundaryEmployeeState {
  employeeId: EmployeeId;
  trailingWorkDays: number;
  trailingRestDays: number;
  recentStates: Array<{ date: ISODate; state: AssignmentState }>;
}

export interface BoundaryState {
  schemaVersion: 1;
  sourceMonth: YearMonth;
  sourceScheduleId?: UUID;
  complete: boolean;
  employees: BoundaryEmployeeState[];
}

export interface Assignment {
  employeeId: EmployeeId;
  date: ISODate;
  state: AssignmentState;
}

export interface ValidationIssue {
  code: string;
  ruleId?: RuleId;
  severity: IssueSeverity;
  employeeId?: EmployeeId;
  date?: ISODate;
  expected?: string | number;
  actual?: string | number;
  sourceIds: UUID[];
  message: string;
}

export interface SoftScore {
  ruleId: SoftConstraintKey;
  score: number;
  violations: number;
}

export interface SolverMetrics {
  status: string;
  wallTimeMs: number;
  objectiveValue?: number;
  bestBound?: number;
  conflicts?: number;
  branches?: number;
}

export interface ManualChange {
  id: UUID;
  changedAt: string;
  employeeId: EmployeeId;
  date: ISODate;
  before: AssignmentState;
  after: AssignmentState;
  mode: 'FORCE' | 'SMART';
  reason?: string;
}

export interface ExportRecord {
  id: UUID;
  exportedAt: string;
  format: 'XLSX' | 'CSV';
  fileName: string;
}

export interface ScheduleResult {
  schemaVersion: 1;
  id: UUID;
  targetMonth: YearMonth;
  createdAt: string;
  updatedAt: string;
  status: ScheduleStatus;
  configSnapshotId?: UUID;
  solverVersion: string;
  randomSeed: number;
  assignments: Assignment[];
  issues: ValidationIssue[];
  softScores: SoftScore[];
  metrics: SolverMetrics;
  boundaryState?: BoundaryState;
  crossMonthVerified: boolean;
  manualChanges: ManualChange[];
  exportRecords: ExportRecord[];
  exceptionReason?: string;
}

export interface GenerateScheduleRequest {
  config: ScheduleConfig;
  targetMonth: YearMonth;
  boundaryState?: BoundaryState;
  timeLimitSeconds?: number;
  randomSeed?: number;
  currentAssignments?: Assignment[];
  requestedChange?: {
    employeeId: EmployeeId;
    date: ISODate;
    state: AssignmentState;
  };
}

export interface HistorySummary {
  id: UUID;
  targetMonth: YearMonth;
  createdAt: string;
  updatedAt: string;
  status: ScheduleStatus;
  solverVersion: string;
  issueCount: number;
}

export interface OperationResult {
  ok: boolean;
  canceled?: boolean;
  message: string;
  filePath?: string;
}

export interface AppInfo {
  appVersion: string;
  schemaVersion: number;
  solverVersion: string;
  dataDirectory: string;
  packaged: boolean;
}

export interface SchedulerApi {
  getAppInfo(): Promise<AppInfo>;
  getConfig(): Promise<ScheduleConfig>;
  saveConfig(config: ScheduleConfig): Promise<ScheduleConfig>;
  resetConfig(): Promise<ScheduleConfig>;
  validateConfig(config: ScheduleConfig, targetMonth: YearMonth, boundaryState?: BoundaryState): Promise<ValidationIssue[]>;
  generateSchedule(request: GenerateScheduleRequest): Promise<ScheduleResult>;
  validateSchedule(config: ScheduleConfig, schedule: ScheduleResult): Promise<ValidationIssue[]>;
  forceChange(config: ScheduleConfig, schedule: ScheduleResult, change: { employeeId: EmployeeId; date: ISODate; state: AssignmentState; reason?: string }): Promise<ScheduleResult>;
  smartRepair(config: ScheduleConfig, schedule: ScheduleResult, change: { employeeId: EmployeeId; date: ISODate; state: AssignmentState }): Promise<ScheduleResult>;
  saveSchedule(schedule: ScheduleResult): Promise<ScheduleResult>;
  listHistory(): Promise<HistorySummary[]>;
  getHistory(id: UUID): Promise<ScheduleResult>;
  exportSchedule(schedule: ScheduleResult, format: 'XLSX' | 'CSV'): Promise<OperationResult>;
  importConfigFromExcel(): Promise<{ config?: ScheduleConfig; issues: ValidationIssue[]; canceled?: boolean }>;
  exportConfigTemplate(config: ScheduleConfig): Promise<OperationResult>;
  exportConfigJson(config: ScheduleConfig): Promise<OperationResult>;
  importConfigJson(): Promise<{ config?: ScheduleConfig; issues: ValidationIssue[]; canceled?: boolean }>;
  importBoundaryFromExcel(config: ScheduleConfig, targetMonth: YearMonth): Promise<{ boundary?: BoundaryState; issues: ValidationIssue[]; canceled?: boolean }>;
  createBackup(reason: string): Promise<OperationResult>;
  listBackups(): Promise<Array<{ name: string; createdAt: string; schemaVersion: number }>>;
  restoreBackup(name: string): Promise<OperationResult>;
}
