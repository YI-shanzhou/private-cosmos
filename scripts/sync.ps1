# 私宇宙 · 本地与 GitHub 同步脚本
# 用法: powershell -ExecutionPolicy Bypass -File scripts/sync.ps1
# 作用: 拉取 GitHub Actions 的自动演化结果，并把本地新 commit 推上去

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot/..

Write-Host ""
Write-Host "==========================================" -ForegroundColor DarkCyan
Write-Host "  私宇宙同步: 本地 <-> GitHub Actions" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor DarkCyan
Write-Host ""

# 1. 检查工作区是否干净
$status = git status --porcelain
if ($status) {
    Write-Host "[!] 本地有未提交的改动，请先 commit 或 stash:" -ForegroundColor Yellow
    Write-Host $status
    Write-Host ""
    Write-Host "    提交: git add -A; git commit -m '你的说明'" -ForegroundColor Gray
    Write-Host "    暂存: git stash" -ForegroundColor Gray
    exit 1
}

# 2. 拉取远程演化结果（rebase 模式，保持历史线性）
Write-Host "[1/3] 拉取 GitHub Actions 的演化结果..." -ForegroundColor Cyan
git pull --rebase origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[X] 拉取时出现冲突，需要手动解决:" -ForegroundColor Red
    Write-Host "    冲突文件:" -ForegroundColor Yellow
    git diff --name-only --diff-filter=U
    Write-Host ""
    Write-Host "    解决步骤:" -ForegroundColor Gray
    Write-Host "    1. 打开冲突文件，保留需要的部分" -ForegroundColor Gray
    Write-Host "    2. git add <冲突文件>" -ForegroundColor Gray
    Write-Host "    3. git rebase --continue" -ForegroundColor Gray
    Write-Host "    4. git push origin main" -ForegroundColor Gray
    exit 1
}

# 3. 检查本地是否有待推送的 commit
$unpushed = git log origin/main..HEAD --oneline
if (-not $unpushed) {
    Write-Host "[2/3] 本地没有新的 commit，无需推送" -ForegroundColor Green
    Write-Host "[3/3] 同步完成" -ForegroundColor Green
    Write-Host ""
    git log --oneline -5
    exit 0
}

Write-Host "[2/3] 本地有以下待推送的 commit:" -ForegroundColor Cyan
Write-Host $unpushed
Write-Host ""

# 4. 推送
Write-Host "[3/3] 推送到 GitHub..." -ForegroundColor Cyan
git push origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[X] 推送失败，可能 Actions 刚刚又提交了，再跑一次本脚本即可" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor DarkGreen
Write-Host "  同步完成!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor DarkGreen
Write-Host ""
Write-Host "最近 5 条提交:" -ForegroundColor Cyan
git log --oneline -5
