# 将 opendota-match-ui 构建并部署到 Vercel（静态站点上的 /data/matches 随 dist 一起发布）
# 需已安装 Node、在项目根或 opendota-match-ui 执行过 vercel link，且已登录 CLI。
# 用法（PowerShell，项目根 PLAB_B）:
#   .\scripts\publish_static_frontend.ps1
# 使用令牌（CI）:
#   $env:VERCEL_TOKEN = "xxx"; .\scripts\publish_static_frontend.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$ui = Join-Path $root "opendota-match-ui"

if (-not (Test-Path $ui)) {
    Write-Error "未找到 opendota-match-ui: $ui"
    exit 1
}

Push-Location $ui
try {
    npm run build
    if ($env:VERCEL_TOKEN) {
        npx vercel deploy --prod --yes --token $env:VERCEL_TOKEN
    } else {
        npx vercel deploy --prod
    }
} finally {
    Pop-Location
}
