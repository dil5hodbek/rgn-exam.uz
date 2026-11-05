$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.local'
$tunnelBinary = Join-Path $runtimeRoot 'cloudflared.exe'
$statePath = Join-Path $runtimeRoot 'public-tunnel.json'
if (!(Test-Path -LiteralPath $tunnelBinary)) { throw 'Missing .local/cloudflared.exe. Download the official Windows executable first.' }
if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.processId)"
    if ($existing -and $existing.ExecutablePath -eq $tunnelBinary) {
        $tunnelHealthy = $true
        try { $null = [System.Net.Dns]::GetHostAddresses(([uri]$state.url).DnsSafeHost) }
        catch { $tunnelHealthy = $false }
        $previousLog = Join-Path $runtimeRoot 'tunnel.err.log'
        if (Test-Path -LiteralPath $previousLog) {
            $recentLog = (Get-Content -LiteralPath $previousLog -Tail 10) -join "`n"
            if ($recentLog -match 'Unauthorized: Tunnel not found') { $tunnelHealthy = $false }
        }
        if ($tunnelHealthy) {
            & (Join-Path $PSScriptRoot 'Start Local.ps1') -PublicUrl $state.url
            Write-Output "Public website: $($state.url)"
            return
        }
        Stop-Process -Id $existing.ProcessId -ErrorAction SilentlyContinue
    }
}
$tunnelLog = Join-Path $runtimeRoot 'tunnel.err.log'
$tunnelProcess = Start-Process $tunnelBinary -ArgumentList 'tunnel --url http://127.0.0.1:13000 --protocol http2 --no-autoupdate' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'tunnel.out.log') -RedirectStandardError $tunnelLog -PassThru
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $tunnelProcess.Refresh()
    if ($tunnelProcess.HasExited) { throw 'Tunnel failed. See .local/tunnel.err.log.' }
    $log = if (Test-Path -LiteralPath $tunnelLog) { Get-Content -LiteralPath $tunnelLog -Raw } else { '' }
    if ([string]::IsNullOrWhiteSpace($log)) { Start-Sleep -Seconds 1; continue }
    $urlMatch = [regex]::Match([string]$log, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($urlMatch.Success) {
        $publicAddress = $urlMatch.Value
        @{ processId = $tunnelProcess.Id; url = $publicAddress } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
        & (Join-Path $PSScriptRoot 'Start Local.ps1') -PublicUrl $publicAddress
        Write-Output "Public website: $publicAddress"
        return
    }
    Start-Sleep -Seconds 1
}
throw 'Tunnel URL not ready. See .local/tunnel.err.log.'
