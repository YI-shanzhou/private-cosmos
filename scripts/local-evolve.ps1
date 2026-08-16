# ============================================================
# 私宇宙 · 本地一键演化流水线（V4 · M5-A，FR-07）
# 链路：sync(sync.ps1) -> evolve(engine/evolve.py)
#       -> fix_empty_collisions.py(容错) -> export(export_data.py,
#       自动 bump sw.js CACHE_VERSION) -> 可选起本地服务
# 与 .github/workflows/daily-evolve.yml 的演化链路口径一致。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/local-evolve.ps1            # 默认演化 1 次
#   powershell -ExecutionPolicy Bypass -File scripts/local-evolve.ps1 -Count 2   # 演化 2 次（对齐 Actions）
#   powershell -ExecutionPolicy Bypass -File scripts/local-evolve.ps1 -Seed 42   # 固定种子（复现实验）
#   powershell -ExecutionPolicy Bypass -File scripts/local-evolve.ps1 -DryRun    # 仅打印命令链，零副作用
#   powershell -ExecutionPolicy Bypass -File scripts/local-evolve.ps1 -Serve     # 导出后起本地服务(8000)
#   powershell -ExecutionPolicy Bypass -File scripts/local-evolve.ps1 -NoSync    # 跳过 git 同步(本地调试)
# ============================================================

param(
    [int]$Count = 1,                                # 演化次数 -> evolve --count
    [int]$Seed = -1,                                # 随机种子（复现实验用）；-1 = 不固定（生产口径）
    [ValidateSet("", "dual", "triple", "lineage")]  # 强制演化路径（调试/验收用），空 = 不强制
    [string]$ForceMode = "",
    [switch]$DryRun,                                # 流水线级 dry-run：打印命令链不执行
    [switch]$NoSync,                                # 跳过 sync.ps1（git 工作区不洁/离线调试）
    [switch]$Serve                                  # 导出后起本地 HTTP 服务（web/ @ 8000）
)

# ---- 环境三件套（纪律 R6）----
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONIOENCODING = "utf-8"

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot/..

function Step($i, $n, $msg) { Write-Host "`n[$i/$n] $msg" -ForegroundColor Cyan }
function Ok($msg)  { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Fail($msg) {
    Write-Host "  [X] $msg" -ForegroundColor Red
    Write-Host "`n流水线失败，退出码 1。数据已备份于 data/backup_evolve_*（如有）。" -ForegroundColor Yellow
    exit 1
}

# ---- 组装 evolve 参数 ----
$evolveArgs = @("engine/evolve.py", "--count", $Count)
if ($Seed -ge 0)   { $evolveArgs += @("--seed", $Seed) }
if ($ForceMode)    { $evolveArgs += @("--force-mode", $ForceMode) }

# 种子展示标签（PS 5.1 无三元运算符，用 if 语句赋值）
$seedLabel = if ($Seed -ge 0) { "$Seed" } else { "(不固定)" }

$evolveCmd  = "python " + ($evolveArgs -join " ")
$fixCmd     = "python scripts/fix_empty_collisions.py  # 容错步骤：失败不阻断（对齐 Actions 的 '|| true'）"
$exportCmd  = "python scripts/export_data.py           # 自动 bump sw.js CACHE_VERSION"

# ---- DryRun：打印命令链，零副作用（不备份/不执行/不动 git）----
if ($DryRun) {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor DarkCyan
    Write-Host "  local-evolve DRY-RUN：以下命令链不会执行" -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor DarkCyan
    Write-Host ""
    if (-not $NoSync) { Write-Host "  [1/5] powershell -ExecutionPolicy Bypass -File scripts/sync.ps1" }
    else              { Write-Host "  [1/5] (跳过：-NoSync)" }
    Write-Host "  [2/5] Copy-Item data/*.json -> data/backup_evolve_<UTC时间戳>/   # R7 数据备份"
    Write-Host "  [3/5] $evolveCmd"
    Write-Host "  [4/5] $fixCmd"
    Write-Host "  [5/5] $exportCmd"
    if ($Serve) { Write-Host "  [+]   python -m http.server 8000 --directory web" }
    Write-Host ""
    Write-Host "参数：Count=$Count Seed=$seedLabel ForceMode='$ForceMode' NoSync=$NoSync" -ForegroundColor Gray
    exit 0
}

$total = 5
Write-Host ""
Write-Host "==========================================" -ForegroundColor DarkCyan
Write-Host "  私宇宙本地演化流水线（V4-M5）" -ForegroundColor Cyan
Write-Host "  参数：Count=$Count Seed=$seedLabel ForceMode='$ForceMode' NoSync=$NoSync Serve=$Serve" -ForegroundColor Gray
Write-Host "==========================================" -ForegroundColor DarkCyan

# ---- [1] sync：与 GitHub Actions 演化结果双向同步 ----
if ($NoSync) {
    Step 1 $total "跳过 sync（-NoSync）"
} else {
    Step 1 $total "git 同步（sync.ps1：拉取远程演化结果 + 推送本地 commit）"
    & powershell -ExecutionPolicy Bypass -File scripts/sync.ps1
    if ($LASTEXITCODE -ne 0) { Fail "sync.ps1 失败（工作区不洁或推送冲突），请先处理后再跑" }
    Ok "同步完成"
}

# ---- [2] R7 数据备份（evolve/pull 都会写 data/*.json，先备份再动数据）----
Step 2 $total "数据备份（R7：data/*.json -> data/backup_evolve_<时间戳>/）"
$ts = (Get-Date).ToUniversalTime().ToString("yyyyMMdd.HHmmss") + "Z"
$backupDir = "data/backup_evolve_$ts"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$copied = Copy-Item data/*.json $backupDir/
$backed = (Get-ChildItem $backupDir -Filter *.json).Count
if ($backed -lt 1) { Fail "备份目录为空，data/*.json 不存在？" }
Ok "已备份 $backed 个 json -> $backupDir（.gitignore 已忽略，不入库）"

# ---- [3] evolve：演化引擎 ----
Step 3 $total "演化引擎（$evolveCmd）"
python @evolveArgs
if ($LASTEXITCODE -ne 0) { Fail "evolve.py 退出码 $LASTEXITCODE" }
Ok "演化完成"

# ---- [4] 修空碰撞（容错，对齐 Actions '|| true'）----
Step 4 $total "空碰撞修复（容错步骤）"
python scripts/fix_empty_collisions.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [!] fix_empty_collisions.py 退出码 $LASTEXITCODE，按 Actions 口径继续（|| true）" -ForegroundColor Yellow
} else {
    Ok "修复通过"
}

# ---- [5] export：导出 web 数据 + 自动 bump CACHE_VERSION ----
Step 5 $total "导出数据（export_data.py，自动 bump sw.js CACHE_VERSION）"
python scripts/export_data.py
if ($LASTEXITCODE -ne 0) { Fail "export_data.py 退出码 $LASTEXITCODE" }
Ok "导出完成"

# ---- bump 证据：git diff 中 CACHE_VERSION 前后对照 ----
Write-Host ""
Write-Host "sw.js CACHE_VERSION bump 证据（git diff）：" -ForegroundColor Cyan
$diffLine = git diff -- web/sw.js | Select-String "CACHE_VERSION"
if ($diffLine) { $diffLine | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray } }
else { Write-Host "  (无 diff——本次导出未触发 bump，请人工核查)" -ForegroundColor Yellow }

Write-Host ""
Write-Host "==========================================" -ForegroundColor DarkGreen
Write-Host "  流水线完成（退出码 0）" -ForegroundColor Green
Write-Host "  下一步：浏览器硬加载验证新数据（?vt=时间戳）" -ForegroundColor Gray
Write-Host "  演化产物记得 commit + push（对齐 Actions 行为）" -ForegroundColor Gray
Write-Host "==========================================" -ForegroundColor DarkGreen

# ---- 可选：起本地服务 ----
if ($Serve) {
    Write-Host "`n[+] 启动本地服务：http://localhost:8000（Ctrl+C 停止）" -ForegroundColor Cyan
    python -m http.server 8000 --directory web
}
exit 0