import type { ScheduleConfig, ValidationIssue } from '../../../../../packages/contracts/types';

interface Props {
  config: ScheduleConfig;
  issues: ValidationIssue[];
  title?: string;
  emptyText?: string;
}

export function IssueList({ config, issues, title = '校验结果', emptyText = '当前没有发现问题。' }: Props) {
  return (
    <section className="card issue-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">VALIDATION</p>
          <h3>{title}</h3>
        </div>
        <span className={`count-pill ${issues.some((issue) => issue.severity === 'ERROR') ? 'danger' : ''}`}>{issues.length}</span>
      </div>
      {issues.length === 0 ? <p className="empty-state compact">{emptyText}</p> : (
        <div className="issue-list">
          {issues.map((issue, index) => {
            const employee = config.employees.find((value) => value.id === issue.employeeId);
            return (
              <div className={`issue-item ${issue.severity.toLowerCase()}`} key={`${issue.code}-${issue.employeeId ?? ''}-${issue.date ?? ''}-${index}`}>
                <span className="issue-level">{issue.severity === 'ERROR' ? '错误' : issue.severity === 'WARNING' ? '提醒' : '信息'}</span>
                <div>
                  <strong>{issue.ruleId ? `${issue.ruleId} · ` : ''}{issue.message}</strong>
                  {(employee || issue.date || issue.expected !== undefined) && (
                    <p>{[employee?.name, issue.date, issue.expected !== undefined ? `期望 ${issue.expected}` : '', issue.actual !== undefined ? `实际 ${issue.actual}` : ''].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

