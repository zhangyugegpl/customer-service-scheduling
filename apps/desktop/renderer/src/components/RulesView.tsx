import type { ScheduleConfig, SoftConstraintKey } from '../../../../../packages/contracts/types';
import { getMonthDates } from '../../../../../packages/domain/date';

interface Props {
  config: ScheduleConfig;
  targetMonth: string;
  onChange: (config: ScheduleConfig) => void;
}

const softLabels: Record<SoftConstraintKey, string> = {
  S1: '倒班规避', S2: '中班均匀', S3: '连续双休', S4: '休中休间隔', S5: '每周上班天数',
};

export function RulesView({ config, targetMonth, onChange }: Props) {
  const monthDates = getMonthDates(targetMonth);
  const monthStart = monthDates[0]!;
  const monthEnd = monthDates.at(-1)!;
  const setRuleNumber = (key: keyof ScheduleConfig['rules'], value: number) => onChange({ ...config, rules: { ...config.rules, [key]: value } });
  const setConstraintMode = (key: SoftConstraintKey, mode: 'SOFT' | 'HARD') => onChange({
    ...config,
    softConstraints: {
      ...config.softConstraints,
      modes: { ...config.softConstraints.modes, [key]: mode },
      highestPriority: mode === 'HARD'
        ? config.softConstraints.highestPriority.filter((value) => value !== key)
        : config.softConstraints.highestPriority,
    },
  });
  const updateGroup = (index: number, patch: Partial<ScheduleConfig['rules']['groups'][number]>) => onChange({
    ...config,
    rules: { ...config.rules, groups: config.rules.groups.map((group, current) => current === index ? { ...group, ...patch } : group) },
  });
  const updatePair = (index: number, employeeIndex: 0 | 1, employeeId: string) => onChange({
    ...config,
    rules: {
      ...config.rules,
      exclusionPairs: config.rules.exclusionPairs.map((pair, current) => current === index
        ? { ...pair, employeeIds: employeeIndex === 0 ? [employeeId, pair.employeeIds[1]] : [pair.employeeIds[0], employeeId] }
        : pair),
    },
  });

  const addSpecifiedAssignment = () => {
    const employee = config.employees.find((value) => value.active);
    if (!employee) return;
    onChange({
      ...config,
      specifiedAssignments: [...config.specifiedAssignments, { id: crypto.randomUUID(), employeeId: employee.id, date: monthStart, endDate: monthStart, state: 'OFF', locked: true }],
    });
  };

  const updateSpecifiedAssignmentStart = (index: number, date: string) => onChange({
    ...config,
    specifiedAssignments: config.specifiedAssignments.map((item, current) => current === index
      ? { ...item, date, endDate: (item.endDate ?? item.date) < date ? date : (item.endDate ?? item.date) }
      : item),
  });
  const updateSpecifiedRestStart = (index: number, date: string) => onChange({
    ...config,
    specifiedRestCounts: config.specifiedRestCounts.map((item, current) => current === index
      ? { ...item, date, endDate: (item.endDate ?? item.date) < date ? date : (item.endDate ?? item.date) }
      : item),
  });

  return (
    <div className="view-stack">
      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">RULE STRENGTH</p><h2>规则强度与优先级</h2><p>S2 已开放“必须满足/尽量满足”切换；必须满足时不使用优先级和权重。</p></div></div>
        <div className="rule-grid">
          {(Object.keys(softLabels) as SoftConstraintKey[]).map((key) => {
            const mode = config.softConstraints.modes?.[key] ?? 'SOFT';
            const hard = mode === 'HARD';
            return (
            <div className={`rule-tile ${hard ? 'hard-mode' : ''}`} key={key}>
              <input
                type="checkbox"
                aria-label={`${key} 最高优先级`}
                checked={config.softConstraints.highestPriority.includes(key)}
                disabled={hard}
                onChange={(event) => onChange({
                  ...config,
                  softConstraints: {
                    ...config.softConstraints,
                    highestPriority: event.target.checked
                      ? [...new Set([...config.softConstraints.highestPriority, key])]
                      : config.softConstraints.highestPriority.filter((value) => value !== key),
                  },
                })}
              />
              <span><strong>{key} · {softLabels[key]}</strong><small>{hard ? '必须满足' : '尽量满足 · 相对权重'}</small></span>
              <input aria-label={`${key} 同层权重`} type="number" min="1" max="100" disabled={hard} value={config.softConstraints.weights[key]} onChange={(event) => onChange({ ...config, softConstraints: { ...config.softConstraints, weights: { ...config.softConstraints.weights, [key]: Number(event.target.value) } } })} />
              {key === 'S2' && (
                <label className="rule-mode-control">规则强度
                  <select aria-label="S2 规则强度" value={mode} onChange={(event) => setConstraintMode(key, event.target.value as 'SOFT' | 'HARD')}>
                    <option value="SOFT">尽量满足</option>
                    <option value="HARD">必须满足</option>
                  </select>
                </label>
              )}
            </div>
          );})}
        </div>
      </section>

      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">RANGES</p><h2>区间参数</h2></div></div>
        <div className="field-grid four-columns">
          <label>每周上班最少<input type="number" min="0" max="7" value={config.rules.weeklyWorkMin} onChange={(event) => setRuleNumber('weeklyWorkMin', Number(event.target.value))} /></label>
          <label>每周上班最多<input type="number" min="0" max="7" value={config.rules.weeklyWorkMax} onChange={(event) => setRuleNumber('weeklyWorkMax', Number(event.target.value))} /></label>
          <label>偏好上班天数<input type="number" min="0" max="7" value={config.rules.preferredWeeklyWorkDays} onChange={(event) => setRuleNumber('preferredWeeklyWorkDays', Number(event.target.value))} /></label>
          <label>双休段最少<input type="number" min="0" value={config.rules.consecutiveRestSegmentsMin} onChange={(event) => setRuleNumber('consecutiveRestSegmentsMin', Number(event.target.value))} /></label>
          <label>双休段最多<input type="number" min="0" value={config.rules.consecutiveRestSegmentsMax} onChange={(event) => setRuleNumber('consecutiveRestSegmentsMax', Number(event.target.value))} /></label>
          <label>两休间工作最少<input type="number" min="0" value={config.rules.workBetweenRestMin} onChange={(event) => setRuleNumber('workBetweenRestMin', Number(event.target.value))} /></label>
          <label>两休间工作最多<input type="number" min="0" value={config.rules.workBetweenRestMax} onChange={(event) => setRuleNumber('workBetweenRestMax', Number(event.target.value))} /></label>
          <label>中班允许最大极差<input aria-label="中班允许最大极差" type="number" min="0" max="31" value={config.rules.middleShiftMaxRange ?? 3} onChange={(event) => setRuleNumber('middleShiftMaxRange', Number(event.target.value))} /></label>
        </div>
      </section>

      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">GROUP RULES</p><h2>三人组与互斥对</h2></div><div className="button-row"><button className="secondary-button" onClick={() => onChange({ ...config, rules: { ...config.rules, groups: [...config.rules.groups, { id: crypto.randomUUID(), name: '新三人组', employeeIds: config.employees.slice(0, 3).map((value) => value.id) }] } })}>新增三人组</button><button className="secondary-button" onClick={() => { if (config.employees.length >= 2) onChange({ ...config, rules: { ...config.rules, exclusionPairs: [...config.rules.exclusionPairs, { id: crypto.randomUUID(), name: '新互斥对', employeeIds: [config.employees[0]!.id, config.employees[1]!.id] }] } }); }}>新增互斥对</button></div></div>
        <div className="split-grid">
          <div>
            <h3 className="subheading">三人组</h3>
            {config.rules.groups.map((group, index) => (
              <div className="inline-editor" key={group.id}>
                <input value={group.name} onChange={(event) => updateGroup(index, { name: event.target.value })} />
                <select multiple value={group.employeeIds} onChange={(event) => updateGroup(index, { employeeIds: Array.from(event.target.selectedOptions, (option) => option.value) })}>
                  {config.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                </select>
                <button className="text-button danger-text" onClick={() => onChange({ ...config, rules: { ...config.rules, groups: config.rules.groups.filter((_, current) => current !== index) } })}>删除</button>
              </div>
            ))}
          </div>
          <div>
            <h3 className="subheading">互斥对</h3>
            {config.rules.exclusionPairs.map((pair, index) => (
              <div className="inline-editor pair-editor" key={pair.id}>
                <input value={pair.name} onChange={(event) => onChange({ ...config, rules: { ...config.rules, exclusionPairs: config.rules.exclusionPairs.map((value, current) => current === index ? { ...value, name: event.target.value } : value) } })} />
                <select value={pair.employeeIds[0]} onChange={(event) => updatePair(index, 0, event.target.value)}>{config.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>
                <select value={pair.employeeIds[1]} onChange={(event) => updatePair(index, 1, event.target.value)}>{config.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>
                <button className="text-button danger-text" onClick={() => onChange({ ...config, rules: { ...config.rules, exclusionPairs: config.rules.exclusionPairs.filter((_, current) => current !== index) } })}>删除</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">LOCKED DATES</p><h2>指定日期</h2><p>开始和结束日期为闭区间，范围内每一天都会在生成与智能调班中保持锁定。</p></div><div className="button-row"><button className="secondary-button" onClick={addSpecifiedAssignment}>新增员工指定</button><button className="secondary-button" onClick={() => onChange({ ...config, specifiedRestCounts: [...config.specifiedRestCounts, { id: crypto.randomUUID(), date: monthStart, endDate: monthStart, count: 1 }] })}>新增休息人数</button></div></div>
        <div className="table-shell">
          <table className="editor-table">
            <thead><tr><th>员工</th><th>开始日期</th><th>结束日期</th><th>指定状态</th><th>操作</th></tr></thead>
            <tbody>
              {config.specifiedAssignments.map((value, index) => (
                <tr key={value.id}>
                  <td><select value={value.employeeId} onChange={(event) => onChange({ ...config, specifiedAssignments: config.specifiedAssignments.map((item, current) => current === index ? { ...item, employeeId: event.target.value } : item) })}>{config.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></td>
                  <td><input aria-label="指定开始日期" type="date" min={monthStart} max={monthEnd} value={value.date} onChange={(event) => updateSpecifiedAssignmentStart(index, event.target.value)} /></td>
                  <td><input aria-label="指定结束日期" type="date" min={value.date} max={monthEnd} value={value.endDate ?? value.date} onChange={(event) => onChange({ ...config, specifiedAssignments: config.specifiedAssignments.map((item, current) => current === index ? { ...item, endDate: event.target.value } : item) })} /></td>
                  <td><select value={value.state} onChange={(event) => onChange({ ...config, specifiedAssignments: config.specifiedAssignments.map((item, current) => current === index ? { ...item, state: event.target.value } : item) })}><option value="OFF">休息</option>{config.positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}</select></td>
                  <td><button className="text-button danger-text" onClick={() => onChange({ ...config, specifiedAssignments: config.specifiedAssignments.filter((_, current) => current !== index) })}>删除</button></td>
                </tr>
              ))}
              {config.specifiedRestCounts.map((value, index) => (
                <tr key={value.id}>
                  <td><span className="muted">全组休息人数</span></td>
                  <td><input aria-label="休息人数开始日期" type="date" min={monthStart} max={monthEnd} value={value.date} onChange={(event) => updateSpecifiedRestStart(index, event.target.value)} /></td>
                  <td><input aria-label="休息人数结束日期" type="date" min={value.date} max={monthEnd} value={value.endDate ?? value.date} onChange={(event) => onChange({ ...config, specifiedRestCounts: config.specifiedRestCounts.map((item, current) => current === index ? { ...item, endDate: event.target.value } : item) })} /></td>
                  <td><input type="number" min="0" value={value.count} onChange={(event) => onChange({ ...config, specifiedRestCounts: config.specifiedRestCounts.map((item, current) => current === index ? { ...item, count: Number(event.target.value) } : item) })} /></td>
                  <td><button className="text-button danger-text" onClick={() => onChange({ ...config, specifiedRestCounts: config.specifiedRestCounts.filter((_, current) => current !== index) })}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
