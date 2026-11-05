$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $projectRoot 'frontend'
$readyPath = Join-Path $projectRoot '.local\production-ready.json'
$activeBuildDirectory = if (Test-Path -LiteralPath $readyPath) { (Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json).distDir } else { '' }
$buildDirectory = if ($activeBuildDirectory -eq '.next-share-a') { '.next-share-b' } else { '.next-share-a' }
$buildRoot = Join-Path $frontendRoot $buildDirectory
$previousBuildDir = $env:NEXT_BUILD_DIR
$previousBackend = $env:BACKEND_INTERNAL_URL
Push-Location $frontendRoot
try {
    $env:NEXT_BUILD_DIR = $buildDirectory
    $env:BACKEND_INTERNAL_URL = 'http://127.0.0.1:18001'
    & node node_modules/next/dist/bin/next build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed. The running website has not been stopped.' }
    if (!(Test-Path -LiteralPath (Join-Path $buildRoot 'BUILD_ID'))) { throw 'Production build ID was not generated.' }
    @{ buildId = (Get-Content (Join-Path $buildRoot 'BUILD_ID') -Raw).Trim(); distDir = $buildDirectory; builtAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $readyPath -Encoding utf8
    Write-Output 'Production website prepared. Restart the web process and run Start Public.ps1.'
} finally {
    $env:NEXT_BUILD_DIR = $previousBuildDir
    $env:BACKEND_INTERNAL_URL = $previousBackend
    Pop-Location
}
