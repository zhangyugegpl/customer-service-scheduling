@echo off
setlocal
REM 客服排班计划工具：双击或在 cmd 中运行的一键安装入口
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
if errorlevel 1 (
  echo.
  echo 安装未完成，请查看上方错误和 docs\安装与常见问题.md。
  exit /b 1
)
echo.
echo 安装与基础健康检查已完成。
endlocal
