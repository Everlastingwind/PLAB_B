param(
  [string]$RepoRoot = "E:\PLAB_B",
  [string]$PythonExe = "python",
  [string]$TaskName = "PLAB_Daily_ProSync_0700",
  [string]$Time = "07:00",
  [string]$Branch = "main",
  [string]$Remote = "origin",
  [int]$ProFetchLimit = 20,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

$runner = Join-Path $RepoRoot "scripts\run_daily_pro_sync.py"
if (-not (Test-Path $runner)) {
  throw "找不到脚本: $runner"
}

$pushArg = ""
if (-not $NoPush) {
  $pushArg = " --push --remote $Remote --branch $Branch"
}

# 使用 cmd /c 注入环境变量，并切到仓库目录执行
$cmdLine = "cd /d `"$RepoRoot`" && set PRO_FETCH_LIMIT=$ProFetchLimit&& `"$PythonExe`" `"$runner`"$pushArg"

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c $cmdLine"
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Write-Host "已创建/更新计划任务: $TaskName"
Write-Host "时间: 每天 $Time"
Write-Host "命令: cmd.exe /c $cmdLine"
if ($NoPush) {
  Write-Host "模式: 仅抓取，不自动 push"
} else {
  Write-Host "模式: 抓取 + 自动 commit/push"
}
