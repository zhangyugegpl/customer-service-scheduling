import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AppInfo,
  AssignmentState,
  BoundaryState,
  HistorySummary,
  ScheduleConfig,
  ScheduleResult,
  ValidationIssue,
} from '../../../../packages/contracts/types';
import { BoundaryView } from './components/BoundaryView';
import { ConfigView } from './components/ConfigView';
import { HistoryView } from './components/HistoryView';
import { PeoplePositionsView } from './components/PeoplePositionsView';
import { RulesView } from './components/RulesView';
import { ScheduleView } from './components/ScheduleView';

type Tab = 'schedule' | 'people' | 'rules' | 'boundary' | 'history' | 'config';

const tabs: Array<{ id: Tab; label: string; icon: string; description: string }> = [
  { id: 'schedule', label: '排班预览', icon: '▦', description: '生成、调整与导出' },
  { id: 'people', label: '人员与岗位', icon: '◎', description: '人员、技能和配额' },
  { id: 'rules', label: '排班规则', icon: '⌘', description: '约束、权重和指定日' },
  { id: 'boundary', label: '上月衔接', icon: '↔', description: '跨月连续状态' },
  { id: 'history', label: '历史记录', icon: '◷', description: '已保存排班版本' },
  { id: 'config', label: '配置管理', icon: '◇', description: '导入、备份与恢复' },
];

function nextMonth(): string {
  const value = new Date();
  value.setMonth(value.getMonth() + 1, 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('schedule');
  const [config, setConfig] = useState<ScheduleConfig>();
  const [appInfo, setAppInfo] = useState<AppInfo>();
  const [targetMonth, setTargetMonth] = useState(nextMonth);
  const [boundary, setBoundary] = useState<BoundaryState>();
  const [schedule, setSchedule] = useState<ScheduleResult>();
  const [preflightIssues, setPreflightIssues] = useState<ValidationIssue[]>([]);
  const [history, setHistory] = useState<HistorySummary[]>([]);
  const [backups, setBackups] = useState<Array<{ name: string; createdAt: string; schemaVersion: number }>>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error' | 'info'; message: string }>();

  const notify = useCallback((kind: 'success' | 'error' | 'info', message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(undefined), 4200);
  }, []);

  const refreshHistory = useCallback(async () => setHistory(await window.schedulerApi.listHistory()), []);
  const refreshBackups = useCallback(async () => setBackups(await window.schedulerApi.listBackups()), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      window.schedulerApi.getConfig(),
      window.schedulerApi.getAppInfo(),
      window.schedulerApi.listHistory(),
      window.schedulerApi.listBackups(),
    ]).then(([loadedConfig, info, loadedHistory, loadedBackups]) => {
      if (!active) return;
      setConfig(loadedConfig);
      setAppInfo(info);
      setHistory(loadedHistory);
      setBackups(loadedBackups);
    }).catch((error) => notify('error', `应用初始化失败：${errorMessage(error)}`));
    return () => { active = false; };
  }, [notify]);

  useEffect(() => {
    if (!config) return;
    let canceled = false;
    const timer = window.setTimeout(() => {
      window.schedulerApi.validateConfig(config, targetMonth, boundary)
        .then((issues) => { if (!canceled) setPreflightIssues(issues); })
        .catch((error) => { if (!canceled) notify('error', `配置校验失败：${errorMessage(error)}`); });
    }, 300);
    return () => { canceled = true; window.clearTimeout(timer); };
  }, [config, targetMonth, boundary, notify]);

  const updateConfig = (next: ScheduleConfig) => {
    setConfig({ ...next, updatedAt: new Date().toISOString() });
    setDirty(true);
  };

  const saveConfig = async () => {
    if (!config) return;
    try {
      const saved = await window.schedulerApi.saveConfig(config);
      setConfig(saved);
      setDirty(false);
      notify('success', '配置已保存，并创建了版本快照。');
    } catch (error) {
      notify('error', `保存失败：${errorMessage(error)}`);
    }
  };

  const generate = async () => {
    if (!config) return;
    setBusy(true);
    try {
      const saved = dirty ? await window.schedulerApi.saveConfig(config) : config;
      setConfig(saved);
      setDirty(false);
      const result = await window.schedulerApi.generateSchedule({ config: saved, targetMonth, boundaryState: boundary, timeLimitSeconds: 5, randomSeed: Date.now() % 2_147_483_647 });
      setSchedule(result);
      setActiveTab('schedule');
      if (result.status === 'PUBLISHABLE') notify('success', `排班生成完成，用时 ${result.metrics.wallTimeMs}ms。`);
      else if (result.status === 'EXCEPTION') notify('info', '已生成有例外方案，请检查问题清单。');
      else notify('error', result.issues[0]?.message ?? '未生成可用排班。');
    } catch (error) {
      notify('error', `生成失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveSchedule = async () => {
    if (!schedule) return;
    try {
      const saved = await window.schedulerApi.saveSchedule(schedule);
      setSchedule(saved);
      await refreshHistory();
      notify('success', '排班版本已保存。');
    } catch (error) {
      notify('error', `保存排班失败：${errorMessage(error)}`);
    }
  };

  const exportSchedule = async (format: 'XLSX' | 'CSV') => {
    if (!schedule) return;
    try {
      const result = await window.schedulerApi.exportSchedule(schedule, format);
      notify(result.ok ? 'success' : result.canceled ? 'info' : 'error', result.message);
      if (result.ok) await refreshHistory();
    } catch (error) {
      notify('error', `导出失败：${errorMessage(error)}`);
    }
  };

  const forceChange = async (employeeId: string, date: string, state: AssignmentState, reason: string) => {
    if (!config || !schedule) return;
    setBusy(true);
    try {
      setSchedule(await window.schedulerApi.forceChange(config, schedule, { employeeId, date, state, reason }));
      notify('success', '已应用强制修改并重新校验。');
    } catch (error) {
      notify('error', `修改失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const smartRepair = async (employeeId: string, date: string, state: AssignmentState) => {
    if (!config || !schedule) return;
    setBusy(true);
    try {
      const repaired = await window.schedulerApi.smartRepair(config, schedule, { employeeId, date, state });
      setSchedule(repaired);
      notify(repaired.status === 'PUBLISHABLE' ? 'success' : 'info', repaired.status === 'PUBLISHABLE' ? '智能调班完成，硬约束全部满足。' : '已生成调整建议，请检查例外。');
    } catch (error) {
      notify('error', `智能调班失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const importBoundary = async () => {
    if (!config) return;
    try {
      const result = await window.schedulerApi.importBoundaryFromExcel(config, targetMonth);
      if (result.canceled) return;
      if (result.boundary) setBoundary(result.boundary);
      notify(result.issues.some((value) => value.severity === 'ERROR') ? 'error' : 'success', result.issues[0]?.message ?? '上月边界导入完成。');
    } catch (error) {
      notify('error', `上月排班导入失败：${errorMessage(error)}`);
    }
  };

  const openHistory = async (id: string) => {
    try {
      const loaded = await window.schedulerApi.getHistory(id);
      setSchedule(loaded);
      setTargetMonth(loaded.targetMonth);
      setActiveTab('schedule');
      notify('info', '已打开历史排班版本。');
    } catch (error) {
      notify('error', `读取历史失败：${errorMessage(error)}`);
    }
  };

  const importExcelConfig = async () => {
    const result = await window.schedulerApi.importConfigFromExcel();
    if (result.canceled) return;
    if (result.config) {
      updateConfig(result.config);
      notify('success', '配置模板解析成功，请核对后保存。');
    } else notify('error', result.issues[0]?.message ?? '配置导入失败。');
  };

  const importJsonConfig = async () => {
    const result = await window.schedulerApi.importConfigJson();
    if (result.canceled) return;
    if (result.config) {
      updateConfig(result.config);
      notify('success', 'JSON 配置解析成功，请核对后保存。');
    } else notify('error', result.issues[0]?.message ?? '配置导入失败。');
  };

  const resetConfig = async () => {
    if (!window.confirm('确定重置当前配置吗？系统会先创建保护性备份。')) return;
    const value = await window.schedulerApi.resetConfig();
    setConfig(value);
    setSchedule(undefined);
    setBoundary(undefined);
    setDirty(false);
    await refreshBackups();
    notify('success', '已恢复默认配置。');
  };

  const restoreBackup = async (name: string) => {
    if (!window.confirm('恢复将整体切换配置、排班历史和边界状态，确定继续吗？')) return;
    const result = await window.schedulerApi.restoreBackup(name);
    setConfig(await window.schedulerApi.getConfig());
    setSchedule(undefined);
    setBoundary(undefined);
    setDirty(false);
    await Promise.all([refreshHistory(), refreshBackups()]);
    notify(result.ok ? 'success' : 'error', result.message);
  };

  const activeLabel = useMemo(() => tabs.find((tab) => tab.id === activeTab)?.label ?? '', [activeTab]);
  if (!config) return <div className="app-loading"><div className="loading-mark">CS</div><p>正在加载排班工作台…</p></div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">CS</div><div><strong>客服排班</strong><span>Planning Studio</span></div></div>
        <nav>{tabs.map((tab) => <button className={activeTab === tab.id ? 'active' : ''} key={tab.id} onClick={() => setActiveTab(tab.id)}><span className="nav-icon">{tab.icon}</span><span><strong>{tab.label}</strong><small>{tab.description}</small></span></button>)}</nav>
        <div className="sidebar-footer"><span className="online-dot" /><div><strong>离线本地运行</strong><small>数据不会上传云端</small></div></div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div><p className="breadcrumb">客服排班 / {activeLabel}</p><h1>{activeLabel}</h1></div>
          <div className="topbar-actions">
            <label className="month-control"><span>排班月份</span><input type="month" value={targetMonth} onChange={(event) => { setTargetMonth(event.target.value); setSchedule(undefined); setBoundary(undefined); }} /></label>
            {dirty && <span className="unsaved-badge">配置未保存</span>}
            <button className="primary-button" disabled={busy} onClick={() => void generate()}>{busy ? '处理中…' : '生成排班'}</button>
          </div>
        </header>
        <div className="content-area">
          {activeTab === 'schedule' && <ScheduleView config={config} schedule={schedule} preflightIssues={preflightIssues} busy={busy} onGenerate={generate} onSave={saveSchedule} onExport={exportSchedule} onForceChange={forceChange} onSmartRepair={smartRepair} onExceptionReason={(exceptionReason) => schedule && setSchedule({ ...schedule, exceptionReason })} />}
          {activeTab === 'people' && <PeoplePositionsView config={config} onChange={updateConfig} />}
          {activeTab === 'rules' && <RulesView config={config} targetMonth={targetMonth} onChange={updateConfig} />}
          {activeTab === 'boundary' && <BoundaryView config={config} targetMonth={targetMonth} boundary={boundary} onChange={setBoundary} onImport={importBoundary} />}
          {activeTab === 'history' && <HistoryView history={history} onRefresh={refreshHistory} onOpen={openHistory} />}
          {activeTab === 'config' && <ConfigView config={config} appInfo={appInfo} dirty={dirty} backups={backups} onSave={saveConfig} onImportExcel={importExcelConfig} onExportTemplate={async () => { const result = await window.schedulerApi.exportConfigTemplate(config); notify(result.ok ? 'success' : 'info', result.message); }} onImportJson={importJsonConfig} onExportJson={async () => { const result = await window.schedulerApi.exportConfigJson(config); notify(result.ok ? 'success' : 'info', result.message); }} onReset={resetConfig} onCreateBackup={async () => { const result = await window.schedulerApi.createBackup('用户手动备份'); await refreshBackups(); notify(result.ok ? 'success' : 'error', result.message); }} onRestore={restoreBackup} onRefreshBackups={refreshBackups} />}
        </div>
      </main>
      {toast && <div className={`toast ${toast.kind}`}><span>{toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '!' : 'i'}</span>{toast.message}</div>}
    </div>
  );
}
