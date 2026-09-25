import type { BoundaryState, ScheduleConfig } from '../../../../../packages/contracts/types';
import { getMonthDates, previousMonth } from '../../../../../packages/domain/date';

interface Props {
  config: ScheduleConfig;
  targetMonth: string;
  boundary?: BoundaryState;
  onChange: (boundary?: BoundaryState) => void;
  onImport: () => Promise<void>;
}

export function BoundaryView({ config, targetMonth, boundary, onChange, onImport }: Props) {
  const sourceMonth = previousMonth(targetMonth);
  const lastDate = getMonthDates(sourceMonth).at(-1)!;
  const createManual = () => onChange({
    schemaVersion: 1,
    sourceMonth,
    complete: true,
    employees: config.employees.filter((employee) => employee.active).map((employee) => ({
      employeeId: employee.id,
      trailingWorkDays: 0,
      trailingRestDays: 0,
      recentStates: [{ date: lastDate, state: 'OFF' }],
    })),
  });

  const updateEmployee = (employeeId: string, patch: Partial<BoundaryState['employees'][number]>) => {
    if (!boundary) return;
    onChange({ ...boundary, employees: boundary.employees.map((value) => value.employeeId === employeeId ? { ...value, ...patch } : value) });
  };

  return (
    <div className="view-stack">
      <section className="card hero-card boundary-hero">
        <div>
          <p className="eyebrow">CROSS-MONTH CONTINUITY</p>
          <h2>{sourceMonth} → {targetMonth} 跨月衔接</h2>
          <p>读取上月最后 7 天，用于连休、连续上班、倒班和月初残缺自然周校验。</p>
        </div>
        <div className="button-row">
          <button className="primary-button" onClick={() => void onImport()}>导入上月排班</button>
          <button className="secondary-button" onClick={createManual}>手工录入边界</button>
          {boundary && <button className="text-button danger-text" onClick={() => onChange(undefined)}>清除</button>}
        </div>
      </section>

      {!boundary ? (
        <section className="card empty-state">
          <span className="empty-icon">↔</span>
          <h3>尚未提供上月边界</h3>
          <p>仍可生成排班，但结果会标记“跨月规则未完整校验”。</p>
        </section>
      ) : (
        <section className="card">
          <div className="section-heading">
            <div><p className="eyebrow">BOUNDARY DATA</p><h2>边界明细</h2><p>{boundary.complete ? '数据完整' : '数据不完整'} · 来源月份 {boundary.sourceMonth}</p></div>
            <label className="toggle-label"><input type="checkbox" checked={boundary.complete} onChange={(event) => onChange({ ...boundary, complete: event.target.checked })} />标记为完整</label>
          </div>
          <div className="table-shell">
            <table className="editor-table">
              <thead><tr><th>员工</th><th>月末连续上班</th><th>月末连续休息</th><th>最后一天状态</th></tr></thead>
              <tbody>
                {boundary.employees.map((value) => {
                  const employee = config.employees.find((item) => item.id === value.employeeId);
                  const last = value.recentStates.at(-1) ?? { date: lastDate, state: 'OFF' };
                  return (
                    <tr key={value.employeeId}>
                      <td>{employee?.name ?? '未知员工'}</td>
                      <td><input type="number" min="0" value={value.trailingWorkDays} onChange={(event) => updateEmployee(value.employeeId, { trailingWorkDays: Number(event.target.value), trailingRestDays: Number(event.target.value) > 0 ? 0 : value.trailingRestDays })} /></td>
                      <td><input type="number" min="0" value={value.trailingRestDays} onChange={(event) => updateEmployee(value.employeeId, { trailingRestDays: Number(event.target.value), trailingWorkDays: Number(event.target.value) > 0 ? 0 : value.trailingWorkDays })} /></td>
                      <td>
                        <select value={last.state} onChange={(event) => updateEmployee(value.employeeId, { recentStates: [{ date: lastDate, state: event.target.value }] })}>
                          <option value="OFF">休息</option>
                          {config.positions.filter((position) => employee?.skillPositionIds.includes(position.id)).map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

