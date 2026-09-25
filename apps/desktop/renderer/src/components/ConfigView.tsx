import type { AppInfo, ScheduleConfig } from '../../../../../packages/contracts/types';

interface Props {
  config: ScheduleConfig;
  appInfo?: AppInfo;
  dirty: boolean;
  backups: Array<{ name: string; createdAt: string; schemaVersion: number }>;
  onSave: () => Promise<void>;
  onImportExcel: () => Promise<void>;
  onExportTemplate: () => Promise<void>;
  onImportJson: () => Promise<void>;
  onExportJson: () => Promise<void>;
  onReset: () => Promise<void>;
  onCreateBackup: () => Promise<void>;
  onRestore: (name: string) => Promise<void>;
  onRefreshBackups: () => Promise<void>;
}

export function ConfigView({ config, appInfo, dirty, backups, onSave, onImportExcel, onExportTemplate, onImportJson, onExportJson, onReset, onCreateBackup, onRestore, onRefreshBackups }: Props) {
  return (
    <div className="view-stack">
      <section className="card hero-card config-hero">
        <div><p className="eyebrow">CONFIGURATION</p><h2>{config.name}</h2><p>{config.employees.length} 名员工 · {config.positions.length} 个岗位 · schema v{config.schemaVersion} · template {config.templateVersion}</p></div>
        <div className="button-row"><span className={`dirty-indicator ${dirty ? 'active' : ''}`}>{dirty ? '有未保存修改' : '配置已保存'}</span><button className="primary-button" onClick={() => void onSave()}>保存配置</button></div>
      </section>

      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">IMPORT / EXPORT</p><h2>配置导入与迁移</h2><p>导入覆盖前由数据层保留快照；Excel 模板带独立版本号。</p></div></div>
        <div className="action-grid">
          <button className="action-card" onClick={() => void onExportTemplate()}><strong>导出 Excel 配置模板</strong><span>包含当前员工、岗位、规则和指定日期</span></button>
          <button className="action-card" onClick={() => void onImportExcel()}><strong>导入 Excel 配置</strong><span>解析、校验并预览错误</span></button>
          <button className="action-card" onClick={() => void onExportJson()}><strong>导出 JSON 备份</strong><span>用于人工审阅或迁移</span></button>
          <button className="action-card" onClick={() => void onImportJson()}><strong>导入 JSON 配置</strong><span>严格校验 schemaVersion</span></button>
        </div>
      </section>

      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">BACKUP & RESTORE</p><h2>备份与恢复</h2><p>恢复会先备份当前数据，再以完整快照切换配置、历史与边界。</p></div><div className="button-row"><button className="secondary-button" onClick={() => void onCreateBackup()}>立即备份</button><button className="text-button" onClick={() => void onRefreshBackups()}>刷新</button></div></div>
        {backups.length === 0 ? <p className="empty-state compact">暂无备份。</p> : <div className="backup-list">{backups.map((backup) => <div className="backup-item" key={backup.name}><div><strong>{new Date(backup.createdAt).toLocaleString('zh-CN')}</strong><p>schema v{backup.schemaVersion} · {backup.name}</p></div><button className="secondary-button" onClick={() => void onRestore(backup.name)}>恢复</button></div>)}</div>}
      </section>

      <section className="card danger-zone">
        <div><p className="eyebrow">DANGER ZONE</p><h2>重置当前配置</h2><p>系统会先创建保护性备份，不删除既有排班历史。</p></div>
        <button className="danger-button" onClick={() => void onReset()}>重置为默认配置</button>
      </section>

      {appInfo && <section className="system-info"><span>应用 {appInfo.appVersion}</span><span>求解器 {appInfo.solverVersion}</span><span>数据目录：{appInfo.dataDirectory}</span></section>}
    </div>
  );
}
