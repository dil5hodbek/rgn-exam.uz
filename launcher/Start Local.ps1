param([string]$PublicUrl = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.local'
# Telegram links must follow the computer's current Wi-Fi/Ethernet address.
$localNetwork = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.IPv4Address } | Select-Object -First 1
$localHostAddress = if ($localNetwork) { $localNetwork.IPv4Address.IPAddress | Select-Object -First 1 } else { 'localhost' }
$localFrontendUrl = "http://${localHostAddress}:13000"
$publicStatePath = Join-Path $runtimeRoot 'public-tunnel.json'
if (!$PublicUrl -and (Test-Path -LiteralPath $publicStatePath)) {
    $publicState = Get-Content -LiteralPath $publicStatePath -Raw | ConvertFrom-Json
    $publicProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($publicState.processId)"
    if ($publicProcess -and $publicProcess.ExecutablePath -eq (Join-Path $runtimeRoot 'cloudflared.exe')) { $PublicUrl = $publicState.url }
}
if ($PublicUrl) {
    if ($PublicUrl -notmatch '^https://[a-z0-9-]+\.trycloudflare\.com$') { throw 'Invalid public tunnel URL.' }
    $localFrontendUrl = $PublicUrl
}
$envFile = Join-Path $projectRoot '.env'
$envContents = [System.IO.File]::ReadAllText($envFile)
$urlChanged = $envContents -notmatch ('(?m)^FRONTEND_URL=' + [regex]::Escape($localFrontendUrl) + '\r?$')
if ($urlChanged) {
    $updatedContents = if ($envContents -match '(?m)^FRONTEND_URL=') {
        [regex]::Replace($envContents, '(?m)^FRONTEND_URL=[^\r\n]*', "FRONTEND_URL=$localFrontendUrl")
    } else { $envContents + "`nFRONTEND_URL=$localFrontendUrl`n" }
    [System.IO.File]::WriteAllText($envFile, $updatedContents, [System.Text.UTF8Encoding]::new($false))
    $backendPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
    $processes = Get-CimInstance Win32_Process
    $backendProcesses = $processes | Where-Object { $_.ExecutablePath -eq $backendPython -and $_.CommandLine -match 'uvicorn.*18001' }
    foreach ($backendProcess in $backendProcesses) {
        $processes | Where-Object { $_.ParentProcessId -eq $backendProcess.ProcessId -and $_.Name -eq 'python.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
        Stop-Process -Id $backendProcess.ProcessId -ErrorAction SilentlyContinue
    }
}
$env:FRONTEND_URL = $localFrontendUrl
function Test-LocalPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { return $client.ConnectAsync('127.0.0.1', $Port).Wait(500) -and $client.Connected }
    catch { return $false }
    finally { $client.Dispose() }
}
function Wait-LocalPort([int]$Port) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-LocalPort $Port) { return }
        Start-Sleep -Seconds 1
    }
    throw "Local service on port $Port did not start. Check .local logs."
}
if (!(Test-LocalPort 15432)) {
    $pgArgs = '-D "' + (Join-Path $runtimeRoot 'postgres') + '" -l "' + (Join-Path $runtimeRoot 'postgres.log') + '" -o "-h 127.0.0.1 -p 15432" -w start'
    Start-Process 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -ArgumentList $pgArgs -WindowStyle Hidden
    Wait-LocalPort 15432
}
if (!(Test-LocalPort 16379)) {
    Start-Process (Join-Path $runtimeRoot 'memurai\Memurai\memurai.exe') -ArgumentList '--bind 127.0.0.1 --port 16379 --dir .local --appendonly yes --save "60 1"' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'redis.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'redis.err.log')
    Wait-LocalPort 16379
}
if (!(Test-LocalPort 18001)) {
    Start-Process (Join-Path $projectRoot '.venv\Scripts\python.exe') -ArgumentList '-m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 18001 --log-level info' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'backend.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'backend.err.log')
    Wait-LocalPort 18001
}
$productionBuild = Join-Path $projectRoot 'frontend\.next-share\BUILD_ID'
$productionReady = Join-Path $runtimeRoot 'production-ready.json'
$webRuntimePath = Join-Path $runtimeRoot 'web-runtime.json'
$productionBuildId = ''
$productionBuildDirectory = '.next-share'
if (Test-Path -LiteralPath $productionReady) {
    $ready = Get-Content -LiteralPath $productionReady -Raw | ConvertFrom-Json
    if ($ready.distDir) {
        if ($ready.distDir -notmatch '^\.next-share(?:-[ab])?$') { throw 'Invalid production build directory.' }
        $productionBuildDirectory = $ready.distDir
    }
    $productionBuild = Join-Path $projectRoot "frontend\$productionBuildDirectory\BUILD_ID"
    if (Test-Path -LiteralPath $productionBuild) {
        $candidateBuildId = (Get-Content -LiteralPath $productionBuild -Raw).Trim()
        if ($ready.buildId -eq $candidateBuildId) { $productionBuildId = $candidateBuildId }
    }
}
if ($productionBuildId -and (Test-LocalPort 13000)) {
    $runningBuildId = if (Test-Path -LiteralPath $webRuntimePath) { (Get-Content -LiteralPath $webRuntimePath -Raw | ConvertFrom-Json).buildId } else { '' }
    if ($runningBuildId -ne $productionBuildId) {
        $webProcesses = @(Get-CimInstance Win32_Process)
        $webRoots = @($webProcesses | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'node_modules[/\\]next[/\\]dist[/\\]bin[/\\]next (dev|start).*13000' })
        function Stop-LocalWebTree([uint32]$processNumber) {
            foreach ($child in @($webProcesses | Where-Object { $_.ParentProcessId -eq $processNumber })) { Stop-LocalWebTree $child.ProcessId }
            Stop-Process -Id $processNumber -ErrorAction SilentlyContinue
        }
        foreach ($webRoot in $webRoots) { Stop-LocalWebTree $webRoot.ProcessId }
        if ($webRoots.Count -gt 0) {
            for ($waitAttempt = 0; $waitAttempt -lt 50 -and (Test-LocalPort 13000); $waitAttempt++) { Start-Sleep -Milliseconds 100 }
            if (Test-LocalPort 13000) { throw 'Previous frontend is still stopping. Retry Start Public.ps1.' }
        }
    }
}
if (!(Test-LocalPort 13000)) {
    $env:BACKEND_INTERNAL_URL = 'http://127.0.0.1:18001'
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    # Use the bundled native image optimizer when available; WASM is slow on first image requests.
    $nativeImageOptimizer = Join-Path (Split-Path -Parent (Split-Path -Parent $nodePath)) 'node_modules\sharp'
    if (Test-Path -LiteralPath $nativeImageOptimizer) { $env:NEXT_SHARP_PATH = $nativeImageOptimizer }
    if ($productionBuildId) {
        # Build Web.ps1 prepares pages in advance, avoiding dev compilation on visits.
        $env:NEXT_BUILD_DIR = $productionBuildDirectory
        Start-Process $nodePath -ArgumentList 'node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 13000' -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'frontend.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'frontend.err.log')
    } else {
        Start-Process $nodePath -ArgumentList 'node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port 13000' -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'frontend.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'frontend.err.log')
    }
    Wait-LocalPort 13000
    @{ buildId = $productionBuildId; mode = $(if ($productionBuildId) { 'production' } else { 'development' }) } | ConvertTo-Json | Set-Content -LiteralPath $webRuntimePath -Encoding utf8
}
$botPython = Join-Path $runtimeRoot 'bot-venv\Scripts\python.exe'
$botRunning = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $botPython -and $_.CommandLine -match 'bot[/\\]main.py' }
if (!$botRunning) {
    Start-Process $botPython -ArgumentList 'bot/main.py' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'bot.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'bot.err.log')
}
Write-Output 'Local services started: http://localhost:13000'
Write-Output "Phone and Telegram links: $localFrontendUrl"
Write-Output 'Bot status and errors: .local/bot.err.log'
