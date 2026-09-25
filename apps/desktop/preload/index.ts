import { contextBridge, ipcRenderer } from 'electron';
import type { SchedulerApi } from '../../../packages/contracts/types';

const api: SchedulerApi = {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  validateConfig: (config, targetMonth, boundaryState) => ipcRenderer.invoke('config:validate', config, targetMonth, boundaryState),
  generateSchedule: (request) => ipcRenderer.invoke('schedule:generate', request),
  validateSchedule: (config, schedule) => ipcRenderer.invoke('schedule:validate', config, schedule),
  forceChange: (config, schedule, change) => ipcRenderer.invoke('schedule:forceChange', config, schedule, change),
  smartRepair: (config, schedule, change) => ipcRenderer.invoke('schedule:smartRepair', config, schedule, change),
  saveSchedule: (schedule) => ipcRenderer.invoke('schedule:save', schedule),
  listHistory: () => ipcRenderer.invoke('history:list'),
  getHistory: (id) => ipcRenderer.invoke('history:get', id),
  exportSchedule: (schedule, format) => ipcRenderer.invoke('schedule:export', schedule, format),
  importConfigFromExcel: () => ipcRenderer.invoke('config:importExcel'),
  exportConfigTemplate: (config) => ipcRenderer.invoke('config:exportTemplate', config),
  exportConfigJson: (config) => ipcRenderer.invoke('config:exportJson', config),
  importConfigJson: () => ipcRenderer.invoke('config:importJson'),
  importBoundaryFromExcel: (config, targetMonth) => ipcRenderer.invoke('boundary:importExcel', config, targetMonth),
  createBackup: (reason) => ipcRenderer.invoke('backup:create', reason),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  restoreBackup: (name) => ipcRenderer.invoke('backup:restore', name),
};

// `window.scheduler` 是 Chromium 的原生 Scheduling API，必须使用独立名称。
contextBridge.exposeInMainWorld('schedulerApi', api);
