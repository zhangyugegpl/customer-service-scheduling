import type { HistorySummary, ScheduleResult } from '../../../../../packages/contracts/types';

interface Props {
  history: HistorySummary[];
  onRefresh: () => Promise<void>;
  onOpen: (id: string) => Promise<void>;
}

export function HistoryView({ history, onRefresh, onOpen }: Props) {
  return (
    <section className="card">
      <div className="section-heading"><div><p className="eyebrow">VERSIONS</p><h2>排班历史</h2><p>历史版本只读保留，重新生成不会覆盖旧结果。</p></div><button className="secondary-button" onClick={() => void onRefresh()}>刷新</button></div>
      {history.length === 0 ? <div className="empty-state"><span className="empty-icon">◷</span><h3>还没有保存的排班版本</h3></div> : (
        <div className="table-shell">
          <table className="editor-table">
            <thead><tr><th>月份</th><th>状态</th><th>更新时间</th><th>求解器</th><th>问题数</th><th>操作</th></tr></thead>
            <tbody>
              {history.map((item) => <tr key={item.id}><td>{item.targetMonth}</td><td><span className={`status-chip ${item.status.toLowerCase()}`}>{item.status}</span></td><td>{new Date(item.updatedAt).toLocaleString('zh-CN')}</td><td>{item.solverVersion}</td><td>{item.issueCount}</td><td><button className="text-button" onClick={() => void onOpen(item.id)}>打开</button></td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export type OpenHistoryHandler = (schedule: ScheduleResult) => void;

