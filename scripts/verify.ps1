[CmdletBinding()]
param([switch]$IncludeE2E)

# 在发布前执行可重复的编译、测试和求解器健康检查。
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PythonPackages = Join-Path $ProjectRoot '.python-packages'

function Invoke-Checked {
  param([string]$Label, [scriptblock]$Command)
  Write-Host "`n==> $Label" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Label 失败，退出码：$LASTEXITCODE" }
}

Push-Location $ProjectRoot
try {
  if (-not (Test-Path 'node_modules')) { throw '缺少 node_modules，请先运行 scripts/setup.cmd。' }
  if (-not (Test-Path (Join-Path $PythonPackages 'ortools'))) { throw '缺少 OR-Tools，请先运行 scripts/setup.cmd。' }
  $env:PYTHONPATH = $PythonPackages

  Invoke-Checked 'TypeScript 类型检查' { npm.cmd run typecheck }
  Invoke-Checked 'TypeScript 单元与集成测试' { npm.cmd test }
  Invoke-Checked 'Python 求解器测试' { npm.cmd run test:solver }
  Invoke-Checked '生产构建' { npm.cmd run build }
  Invoke-Checked '开发模式求解器健康检查' { python apps/solver/main.py --health }

  if (Test-Path 'apps/solver/dist/scheduler-solver.exe') {
    Invoke-Checked '独立求解器健康检查' { & 'apps/solver/dist/scheduler-solver.exe' --health }
  } else {
    Write-Host '提示：尚未构建独立求解器；npm run release 会自动构建。' -ForegroundColor Yellow
  }

  if ($IncludeE2E) {
    Invoke-Checked 'Electron 端到端测试' { npm.cmd run test:e2e }
  }
  Write-Host "`n全部验证通过。" -ForegroundColor Green
} catch {
  Write-Host "`n验证失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  Pop-Location
}
