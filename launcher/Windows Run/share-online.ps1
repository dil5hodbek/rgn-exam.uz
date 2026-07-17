# ExamFlow ni Cloudflare tunnel orqali internetga ochadi va havolani ko'rsatadi.
# Bu oyna ochiq turgancha havola ishlaydi; oynani yopsangiz havola o'chadi.
$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "        ExamFlow - Internetga ulashish (Cloudflare)" -ForegroundColor Cyan
Write-Host "============================================================`n"

# 1. cloudflared ni topish
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
    foreach ($p in @(
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
    )) { if (Test-Path $p) { $cf = $p; break } }
}
if (-not $cf) {
    Write-Host "[XATO] cloudflared topilmadi." -ForegroundColor Red
    Write-Host "O'rnatish: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    Read-Host "`nChiqish uchun Enter"; exit 1
}

# 2. Ilova ishlayaptimi
try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "http://localhost:13000" | Out-Null
} catch {
    Write-Host "[XATO] http://localhost:13000 ochilmadi." -ForegroundColor Red
    Write-Host "Avval 'Run ExamFlow.bat' ni ishga tushiring."
    Read-Host "`nChiqish uchun Enter"; exit 1
}

# 3. Tunnelni ishga tushirish
$log = Join-Path $env:TEMP "examflow-tunnel.log"
if (Test-Path $log) { Remove-Item $log -Force -ErrorAction SilentlyContinue }
Write-Host "[INFO] Tunnel ishga tushirilmoqda..." -ForegroundColor Yellow

$proc = Start-Process -FilePath $cf `
    -ArgumentList "tunnel","--url","http://localhost:13000" `
    -RedirectStandardError $log -RedirectStandardOutput "$log.out" `
    -NoNewWindow -PassThru

# 4. Havolani logdan o'qish (30 soniyagacha)
$url = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value; break }
    }
}

if (-not $url) {
    Write-Host "[XATO] Havola olinmadi. Internet aloqasini tekshiring." -ForegroundColor Red
    if ($proc -and -not $proc.HasExited) { $proc.Kill() }
    Read-Host "`nChiqish uchun Enter"; exit 1
}

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  ExamFlow endi internetda ochiq!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  HAVOLA:" -ForegroundColor White
Write-Host "  $url" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Green
try { Set-Clipboard -Value $url; Write-Host "  (havola nusxalandi - Ctrl+V bilan yuborish mumkin)" -ForegroundColor DarkGray } catch {}
Write-Host "`n  Bu oyna OCHIQ turishi kerak - yopsangiz havola o'chadi." -ForegroundColor Yellow
Write-Host "  To'xtatish: bu oynada Ctrl+C bosing yoki oynani yoping.`n"

# 5. Tunnel jarayoni tugaguncha kutish (oyna ochiq turadi)
Wait-Process -Id $proc.Id
