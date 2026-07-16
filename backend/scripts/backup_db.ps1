# ExamFlow database backup: dumps PostgreSQL into ./backups with a timestamp.
# Run from the project root:  powershell -File backend\scripts\backup_db.ps1
# Restore with:               Get-Content backups\<file>.sql -Raw | docker compose exec -T postgres psql -U examflow examflow

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$backupDir = Join-Path $root "backups"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }

$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$file = Join-Path $backupDir "examflow_$stamp.sql"

docker compose -f (Join-Path $root "docker-compose.yml") exec -T postgres pg_dump -U examflow examflow | Out-File -FilePath $file -Encoding utf8

if ($LASTEXITCODE -eq 0 -and (Get-Item $file).Length -gt 0) {
    Write-Output "Backup saved: $file ($([math]::Round((Get-Item $file).Length / 1MB, 2)) MB)"
    # Keep the 14 newest backups, delete older ones.
    Get-ChildItem $backupDir -Filter "examflow_*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item -Confirm:$false
} else {
    Write-Error "Backup failed - is the postgres container running?"
}
