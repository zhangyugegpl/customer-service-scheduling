[CmdletBinding()]
param([switch]$SkipTests)

# 生成可分发的 Windows 便携版 EXE 与 ZIP，并逐项验证关键产物。
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$env:PYTHONPATH = Join-Path $ProjectRoot '.python-packages'

function Invoke-Checked {
  param([string]$Label, [scriptblock]$Command)
  Write-Host "`n==> $Label" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Label 失败，退出码：$LASTEXITCODE" }
}

Push-Location $ProjectRoot
try {
  if (-not (Test-Path 'node_modules')) { throw '缺少 Node.js 依赖，请先运行 scripts/setup.cmd。' }
  if (-not (Test-Path '.python-packages/ortools')) { throw '缺少 Python 依赖，请先运行 scripts/setup.cmd。' }
  if (-not $SkipTests) {
    Invoke-Checked '发布前自动验证' { powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 }
  }
  Invoke-Checked '构建独立 OR-Tools 求解器' { npm.cmd run build:solver }
  Invoke-Checked '验证独立求解器' { & 'apps/solver/dist/scheduler-solver.exe' --health }
  Invoke-Checked '构建 Electron/React 应用' { npm.cmd run build }
  Invoke-Checked '生成 Windows 便携版与 ZIP' { npx.cmd electron-builder --win portable zip --x64 }

  $Artifacts = @(Get-ChildItem 'release' -File | Where-Object { $_.Extension -in '.exe', '.zip' })
  if ($Artifacts.Count -lt 2) { throw '发布目录中未同时找到 EXE 与 ZIP。' }
  $ChecksumLines = $Artifacts | ForEach-Object {
    $Hash = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash
    "$Hash  $($_.Name)"
  }
  $ChecksumLines | Set-Content -Path 'release/SHA256SUMS.txt' -Encoding UTF8
  Write-Host "`n发布完成：" -ForegroundColor Green
  $Artifacts | ForEach-Object { Write-Host "- $($_.FullName) ($([math]::Round($_.Length / 1MB, 1)) MB)" }
  Write-Host "- $(Join-Path $ProjectRoot 'release/SHA256SUMS.txt')"
} catch {
  Write-Host "`n发布失败：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '请查看 docs/安装与常见问题.md 的“打包失败”章节。' -ForegroundColor Yellow
  exit 1
} finally {
  Pop-Location
}
