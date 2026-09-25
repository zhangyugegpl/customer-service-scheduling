import type { ScheduleConfig } from '../../../../../packages/contracts/types';

interface Props {
  config: ScheduleConfig;
  onChange: (config: ScheduleConfig) => void;
}

export function PeoplePositionsView({ config, onChange }: Props) {
  const updatePosition = (index: number, patch: Partial<ScheduleConfig['positions'][number]>) => {
    const positions = config.positions.map((position, current) => current === index ? { ...position, ...patch } : position);
    onChange({ ...config, positions });
  };

  const removePosition = (index: number) => {
    const position = config.positions[index];
    if (!position || !window.confirm(`确定删除岗位“${position.name}”吗？相关技能和指定日期也会移除。`)) return;
    onChange({
      ...config,
      positions: config.positions.filter((_, current) => current !== index),
      employees: config.employees.map((employee) => ({ ...employee, skillPositionIds: employee.skillPositionIds.filter((id) => id !== position.id) })),
      specifiedAssignments: config.specifiedAssignments.filter((value) => value.state !== position.id),
    });
  };

  const addPosition = () => {
    onChange({
      ...config,
      positions: [...config.positions, { id: crypto.randomUUID(), name: '新岗位', color: '#DBEAFE', defaultMinQuota: 0, dateQuotaOverrides: {} }],
    });
  };

  const updateEmployee = (index: number, patch: Partial<ScheduleConfig['employees'][number]>) => {
    const employees = config.employees.map((employee, current) => current === index ? { ...employee, ...patch } : employee);
    onChange({ ...config, employees });
  };

  const removeEmployee = (index: number) => {
    const employee = config.employees[index];
    if (!employee || !window.confirm(`确定删除员工“${employee.name}”吗？相关规则与指定日期也会移除。`)) return;
    onChange({
      ...config,
      employees: config.employees.filter((_, current) => current !== index),
      rules: {
        ...config.rules,
        groups: config.rules.groups.map((group) => ({ ...group, employeeIds: group.employeeIds.filter((id) => id !== employee.id) })).filter((group) => group.employeeIds.length >= 2),
        exclusionPairs: config.rules.exclusionPairs.filter((pair) => !pair.employeeIds.includes(employee.id)),
      },
      specifiedAssignments: config.specifiedAssignments.filter((value) => value.employeeId !== employee.id),
    });
  };

  const addEmployee = () => {
    onChange({
      ...config,
      employees: [...config.employees, {
        id: crypto.randomUUID(),
        code: `CS${String(config.employees.length + 1).padStart(3, '0')}`,
        name: '新员工',
        active: true,
        skillPositionIds: config.positions.map((position) => position.id),
        monthlyRestDays: 6,
      }],
    });
  };

  return (
    <div className="view-stack">
      <section className="card">
        <div className="section-heading">
          <div><p className="eyebrow">POSITIONS</p><h2>岗位与最低配额</h2><p>岗位人数是最低值，多出的上班人员可安排到具备技能的岗位。</p></div>
          <button className="secondary-button" onClick={addPosition}>新增岗位</button>
        </div>
        <div className="table-shell">
          <table className="editor-table">
            <thead><tr><th>岗位</th><th>语义色</th><th>默认最低配额</th><th>操作</th></tr></thead>
            <tbody>
              {config.positions.map((position, index) => (
                <tr key={position.id}>
                  <td><input value={position.name} onChange={(event) => updatePosition(index, { name: event.target.value })} /></td>
                  <td><div className="color-input"><input type="color" value={position.color} onChange={(event) => updatePosition(index, { color: event.target.value })} /><code>{position.color}</code></div></td>
                  <td><input type="number" min="0" value={position.defaultMinQuota} onChange={(event) => updatePosition(index, { defaultMinQuota: Number(event.target.value) })} /></td>
                  <td><button className="text-button danger-text" onClick={() => removePosition(index)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div><p className="eyebrow">TEAM</p><h2>员工与技能矩阵</h2><p>员工 ID 保持不变，修改姓名不会破坏历史排班引用。</p></div>
          <button className="secondary-button" onClick={addEmployee}>新增员工</button>
        </div>
        <div className="table-shell">
          <table className="editor-table employee-editor">
            <thead><tr><th>在职</th><th>员工编号</th><th>姓名</th><th>月休</th>{config.positions.map((position) => <th key={position.id}>{position.name}</th>)}<th>操作</th></tr></thead>
            <tbody>
              {config.employees.map((employee, index) => (
                <tr key={employee.id} className={!employee.active ? 'muted-row' : ''}>
                  <td><input type="checkbox" checked={employee.active} onChange={(event) => updateEmployee(index, { active: event.target.checked })} /></td>
                  <td><input value={employee.code} onChange={(event) => updateEmployee(index, { code: event.target.value })} /></td>
                  <td><input value={employee.name} onChange={(event) => updateEmployee(index, { name: event.target.value })} /></td>
                  <td><input className="short-input" type="number" min="0" max="31" value={employee.monthlyRestDays} onChange={(event) => updateEmployee(index, { monthlyRestDays: Number(event.target.value) })} /></td>
                  {config.positions.map((position) => (
                    <td key={position.id} className="center-cell">
                      <input
                        type="checkbox"
                        checked={employee.skillPositionIds.includes(position.id)}
                        onChange={(event) => updateEmployee(index, {
                          skillPositionIds: event.target.checked
                            ? [...new Set([...employee.skillPositionIds, position.id])]
                            : employee.skillPositionIds.filter((id) => id !== position.id),
                        })}
                      />
                    </td>
                  ))}
                  <td><button className="text-button danger-text" onClick={() => removeEmployee(index)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

