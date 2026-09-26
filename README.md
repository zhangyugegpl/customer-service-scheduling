# 客服排班计划工具

基于 Electron、React、TypeScript 与 OR-Tools CP-SAT 的离线 Windows 客服排班工具。实现了从人员与岗位配置、规则配置、跨月衔接、自动求解、人工调整到历史版本与 Excel/CSV 导出的完整流程。

## 已实现功能

- 人员、岗位和“至少达到”的每日岗位配额；
- 一人一天唯一状态：休息、早班、中班、审单、后台；
- H1～H9 硬约束、S1～S5 软约束和可解释问题清单；
- 通用规则强度模型，首期开放 S2 中班均匀“必须满足 / 尽量满足”切换；
- 周一至周日的自然周口径，以及月初/月末残缺周衔接；
- 连休、连续上班和倒班的跨月计算；
- 严格求解失败后的例外方案、强制修改与智能调班；
- 配置 Excel/JSON 导入导出、排班 Excel/CSV 导出；
- 原子化本地存储、历史版本、滚动备份、恢复和异常退出锁恢复；
- 完全离线运行；不包含“弹性日”，也不包含“排班解释与调整助手”。

## 快速开始

```powershell
scripts\setup.cmd -Verify
npm run dev
```

生成 Windows 可分发版本：

```powershell
npm run release
```

详细环境变量、验证标准和故障处理见 [安装与常见问题](docs/安装与常见问题.md)。产品规则与实现依据见 `docs` 目录中的 PRD、版本升级方案和技术方案。

## 目录结构

```text
apps/desktop       Electron 主进程、preload 与 React 界面
apps/solver        Python OR-Tools CP-SAT 求解器
packages/contracts 共享数据协议与版本化 Schema
packages/domain    规则校验、评分和人工调整
packages/persistence 本地 JSON 仓储、历史与备份
packages/excel     Excel/CSV 导入导出
scripts            安装、验证与发布脚本
tests              单元、集成与 Electron E2E 测试
```

## 数据与安全

渲染器启用 `contextIsolation` 和沙箱，仅通过类型化 preload 白名单调用主进程。文件读写只由主进程完成，写入采用临时文件校验后原子替换。可通过 `CSS_SCHEDULER_DATA_DIR` 指定业务数据目录。

## 当前版本

版本 `0.2.0`，配置 Schema v1，模板 v1.1.0，求解器 v1.1.0。开发状态和已验证事项见 [PROGRESS.md](PROGRESS.md)。
