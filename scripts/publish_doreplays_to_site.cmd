@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 正在启动发布脚本...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish_doreplays_to_site.ps1"
exit /b %ERRORLEVEL%
