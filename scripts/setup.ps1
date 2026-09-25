[CmdletBinding()]
param(
  [switch]$SkipNpm,
  [switch]$SkipPython,
  [switch]$Verify
)

# 客服排班计划工具：Windows 开发环境一键安装脚本
# 本脚本不会永久修改系统 PATH；Python 依赖安装在项目内的 .python-packages。
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PythonPackages = Join-Path $ProjectRoot '.python-packages'

function Invoke-Checked {
  param([string]$Label, [scriptblock]$Command)
  Write-Host "`n==> $Label" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label 失败，退出码：$LASTEXITCODE"
  }
}

function Assert-Command {
  param([string]$Name, [string]$InstallHint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "未找到 $Name。$InstallHint"
  }
}

Push-Location $ProjectRoot
try {
  Assert-Command 'node' '请安装 Node.js 20.19 或更高 LTS 版本，并重新打开终端。'
  Assert-Command 'npm' 'Node.js 安装应包含 npm。'
  Assert-Command 'python' '请安装 64 位 Python 3.11～3.12，并勾选 Add Python to PATH。'

  $NodeVersion = [version]((& node -p "process.versions.node").Trim())
  if ($NodeVersion -lt [version]'22.12') { throw "Node.js 版本过低：需要 >= 22.12，当前为 $(& node --version)。" }
  $PythonVersion = (& python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
  if ($LASTEXITCODE -ne 0 -or [version]$PythonVersion -lt [version]'3.11' -or [version]$PythonVersion -ge [version]'3.13') {
    throw "Python 版本不兼容：需要 3.11～3.12，当前为 $PythonVersion。"
  }

  Write-Host "项目目录：$ProjectRoot"
  Write-Host "Node.js：$(& node --version)；npm：$(& npm.cmd --version)；Python：$(& python --version)"

  if (-not $SkipNpm) {
    Invoke-Checked '根据 package-lock.json 安装 Node.js 依赖' { npm.cmd ci }
  }

  if (-not $SkipPython) {
    New-Item -ItemType Directory -Path $PythonPackages -Force | Out-Null
    Invoke-Checked '更新 pip' { python -m pip install --disable-pip-version-check --upgrade pip }
    Invoke-Checked '安装 OR-Tools 与 PyInstaller 到项目本地目录' {
      python -m pip install --disable-pip-version-check --upgrade --target $PythonPackages -r apps/solver/requirements.txt
    }
  }

  # 仅为当前进程配置求解器依赖；应用开发模式也会自动设置该变量。
  $env:PYTHONPATH = $PythonPackages
  Invoke-Checked '验证 Python 求解器' { python apps/solver/main.py --health }

  if ($Verify) {
    Invoke-Checked '运行完整验证' { powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 }
  }

  Write-Host "`n安装完成。" -ForegroundColor Green
  Write-Host '开发运行：npm run dev'
  Write-Host '完整验证：npm run verify'
  Write-Host '生成 Windows 安装包：npm run release'
} catch {
  Write-Host "`n安装失败：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '请查看 docs/安装与常见问题.md；网络受限时先配置 HTTPS_PROXY 或 npm 镜像。' -ForegroundColor Yellow
  exit 1
} finally {
  Pop-Location
}
