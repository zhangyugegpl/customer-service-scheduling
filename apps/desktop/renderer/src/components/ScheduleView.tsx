import { useMemo, useState } from 'react';
import type { AssignmentState, ScheduleConfig, ScheduleResult } from '../../../../../packages/contracts/types';
import { formatChineseDate, getMonthDates } from '../../../../../packages/domain/date';
import { IssueList } from './IssueList';

interface Props {
  config: ScheduleConfig;
  schedule?: ScheduleResult;
  preflightIssues: ScheduleResult['issues'];
  busy: boolean;
  onGenerate: () => Promise<void>;
  onSave: () => Promise<void>;
  onExport: (format: 'XLSX' | 'CSV') => Promise<void>;
  onForceChange: (employeeId: string, date: string, state: AssignmentState, reason: string) => Promise<void>;
  onSmartRepair: (employeeId: string, date: string, state: AssignmentState) => Promise<void>;
  onExceptionReason: (reason: string) => void;
}

const statusLabels: Record<ScheduleResult['status'], string> = {
  PUBLISHABLE: '可发布', EXCEPTION: '有例外', INFEASIBLE: '无可行方案', TIMEOUT: '求解超时',
};

export function ScheduleView({ config, schedule, preflightIssues, busy, onGenerate, onSave, onExport, onForceChange, onSmartRepair, onExceptionReason }: Props) {
  const [selected, setSelected] = useState<{ employeeId: string; date: string; state: AssignmentState }>();
  const [targetState, setTargetState] = useState<AssignmentState>('OFF');
  const [reason, setReason] = useState('');
  const dates = schedule ? getMonthDates(schedule.targetMonth) : [];
  const assignmentMap = useMemo(() => new Map(schedule?.assignments.map((value) => [`${value.employeeId}|${value.date}`, value.state]) ?? []), [schedule]);
  const issueKeys = useMemo(() => new Set(schedule?.issues.filter((value) => value.severity === 'ERROR' && value.employeeId && value.date).map((value) => `${value.employeeId}|${value.date}`) ?? []), [schedule]);

  const openCell = (employeeId: string, date: string) => {
    const state = assignmentMap.get(`${employeeId}|${date}`) ?? 'OFF';
    setSelected({ employeeId, date, state });
    setTargetState(state);
    setReason('');
  };

  if (!schedule) {
    return (
      <div className="view-stack">
        <section className="card hero-card schedule-empty-hero">
          <div><p className="eyebrow">MONTHLY PLAN</p><h2>准备生成本月排班</h2><p>系统会先检查配置、岗位容量、技能和指定日期，再调用约束求解器。</p></div>
          <button className="primary-button large" disabled={busy} onClick={() => void onGenerate()}>{busy ? '正在生成…' : '一键生成排班'}</button>
        </section>
        <IssueList config={config} issues={preflightIssues} title="生成前检查" />
      </div>
    );
  }

  return (
    <div className="view-stack">
      <section className={`status-banner ${schedule.status.toLowerCase()}`}>
        <div>
          <span className="status-dot" />
          <div><p className="eyebrow">SCHEDULE STATUS</p><h2>{statusLabels[schedule.status]}</h2><p>{schedule.targetMonth} · 求解 {schedule.metrics.wallTimeMs}ms · {schedule.solverVersion}</p></div>
        </div>
        <div className="button-row">
          <button className="secondary-button" disabled={busy} onClick={() => void onGenerate()}>{busy ? '处理中…' : '重新生成'}</button>
          <button className="secondary-button" disabled={schedule.assignments.length === 0} onClick={() => void onSave()}>保存版本</button>
          <button className="primary-button" disabled={schedule.assignments.length === 0} onClick={() => void onExport('XLSX')}>导出 Excel</button>
          <button className="secondary-button" disabled={schedule.assignments.length === 0} onClick={() => void onExport('CSV')}>导出 CSV</button>
        </div>
      </section>

      {schedule.status === 'EXCEPTION' && (
        <section className="card exception-card">
          <label>例外方案确认原因<textarea value={schedule.exceptionReason ?? ''} onChange={(event) => onExceptionReason(event.target.value)} placeholder="导出前必须填写主管确认原因" /></label>
        </section>
      )}

      {schedule.assignments.length > 0 && (
        <section className="card schedule-card">
          <div className="section-heading"><div><p className="eyebrow">SCHEDULE GRID</p><h2>月度排班表</h2><p>点击任意单元格进行强制修改或智能调班。</p></div><div className="legend"><span className="legend-item off">休息</span>{config.positions.map((position) => <span className="legend-item" style={{ background: position.color }} key={position.id}>{position.name}</span>)}</div></div>
          <div className="schedule-scroll">
            <table className="schedule-table">
              <thead><tr><th className="sticky-col employee-col">员工</th><th className="sticky-col code-col">编号</th>{dates.map((date) => <th key={date}>{formatChineseDate(date)}</th>)}</tr></thead>
              <tbody>
                {config.employees.filter((employee) => employee.active).map((employee) => (
                  <tr key={employee.id}>
                    <th className="sticky-col employee-col">{employee.name}</th>
                    <td className="sticky-col code-col">{employee.code}</td>
                    {dates.map((date) => {
                      const state = assignmentMap.get(`${employee.id}|${date}`) ?? 'OFF';
                      const position = config.positions.find((value) => value.id === state);
                      const locked = config.specifiedAssignments.some((value) => value.employeeId === employee.id && value.date === date);
                      return (
                        <td key={date} className={issueKeys.has(`${employee.id}|${date}`) ? 'cell-error' : ''}>
                          <button
                            className={`shift-cell ${state === 'OFF' ? 'off' : ''}`}
                            style={position ? { background: position.color } : undefined}
                            onClick={() => openCell(employee.id, date)}
                            title={locked ? '该状态已锁定' : '点击调整'}
                          >{state === 'OFF' ? '休' : position?.name.slice(0, 2) ?? '?' }{locked && <sup>锁</sup>}</button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selected && (
        <section className="card edit-panel">
          <div><p className="eyebrow">ADJUSTMENT</p><h3>{config.employees.find((value) => value.id === selected.employeeId)?.name} · {selected.date}</h3><p>当前：{selected.state === 'OFF' ? '休息' : config.positions.find((value) => value.id === selected.state)?.name}</p></div>
          <label>目标状态<select value={targetState} onChange={(event) => setTargetState(event.target.value)}><option value="OFF">休息</option>{config.positions.filter((position) => config.employees.find((value) => value.id === selected.employeeId)?.skillPositionIds.includes(position.id)).map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}</select></label>
          <label>强制修改原因<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="可选" /></label>
          <div className="button-row"><button className="secondary-button" disabled={busy} onClick={() => void onForceChange(selected.employeeId, selected.date, targetState, reason)}>强制修改</button><button className="primary-button" disabled={busy} onClick={() => void onSmartRepair(selected.employeeId, selected.date, targetState)}>智能调班</button><button className="text-button" onClick={() => setSelected(undefined)}>关闭</button></div>
        </section>
      )}

      <div className="dashboard-grid">
        <IssueList config={config} issues={schedule.issues} title="排班问题" />
        <section className="card score-card">
          <div className="section-heading"><div><p className="eyebrow">SOFT SCORES</p><h3>软约束得分</h3></div></div>
          {schedule.softScores.length === 0 ? <p className="empty-state compact">暂无评分。</p> : schedule.softScores.map((score) => <div className="score-row" key={score.ruleId}><strong>{score.ruleId}</strong><span>{score.violations} 个偏差</span><b>{score.score}</b></div>)}
        </section>
      </div>
    </div>
  );
}

