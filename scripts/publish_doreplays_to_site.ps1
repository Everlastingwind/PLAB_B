#Requires -Version 5.1
<#
.SYNOPSIS
  将 E:\doreplays_json_results（可改）里的解析 JSON 导入网站数据并发布到 dota2planb.com（Vercel 项目 plab-b）。

.DESCRIPTION
  1) 批量转为 slim → opendota-match-ui/public/data/matches
  2) npm run build
  3) npx vercel deploy --prod

  用法（在 PowerShell 里）:
    cd E:\PLAB_B
    .\scripts\publish_doreplays_to_site.ps1

  指定别的目录:
    .\scripts\publish_doreplays_to_site.ps1 -DoreplaysDir "D:\my_json"

  若提示无法运行脚本，可先执行（仅当前用户、一次即可）:
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#>
param(
    [string]$DoreplaysDir = "E:\doreplays_json_results"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BatchScript = Join-Path $RepoRoot "scripts\batch_dem_results_to_matches.py"

function Invoke-Python {
    param([string[]]$Arguments)
    $py = Get-Command python -ErrorAction SilentlyContinue
    if ($py) {
        & python @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Python 退出码 $LASTEXITCODE" }
        return
    }
    $py2 = Get-Command py -ErrorAction SilentlyContinue
    if ($py2) {
        & py @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Python 退出码 $LASTEXITCODE" }
        return
    }
    throw "未找到 python 或 py，请先安装 Python 并加入 PATH。"
}

Write-Host ""
Write-Host "======== PlanB：从 doreplays 发布到线上 ========" -ForegroundColor Cyan
Write-Host "项目目录: $RepoRoot"
Write-Host "JSON 目录: $DoreplaysDir"
Write-Host ""

if (-not (Test-Path -LiteralPath $DoreplaysDir)) {
    Write-Error "目录不存在: $DoreplaysDir"
    exit 1
}
if (-not (Test-Path -LiteralPath $BatchScript)) {
    Write-Error "未找到脚本: $BatchScript"
    exit 1
}

Push-Location $RepoRoot
try {
    Write-Host "[1/3] 正在把解析 JSON 转为网站比赛数据并更新索引..." -ForegroundColor Yellow
    Invoke-Python -Arguments @($BatchScript, $DoreplaysDir)
    if ($LASTEXITCODE -ne 0) { throw "batch_dem_results_to_matches.py 退出码 $LASTEXITCODE" }

    Write-Host ""
    Write-Host "[2/3] 正在打包前端 (npm run build)..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }

    Write-Host ""
    Write-Host "[3/3] 正在部署到生产环境 (Vercel)..." -ForegroundColor Yellow
    npx vercel deploy --prod --yes
    if ($LASTEXITCODE -ne 0) { throw "vercel deploy 失败" }

    Write-Host ""
    Write-Host "======== 完成。请打开 https://dota2planb.com 查看 ========" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "失败: $_" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}

if ($Host.Name -eq "ConsoleHost" -or $Host.Name -eq "Windows PowerShell ISE Host") {
    Write-Host ""
    Read-Host "按 Enter 关闭窗口"
}
