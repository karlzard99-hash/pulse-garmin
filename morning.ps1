# Morning refresh: pull the last days from Garmin, top up the history, rebuild the dashboard data.
# Run by the 06:30 Claude scheduled task, which then republishes the dashboard. Safe to run by hand.
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$log = Join-Path $PSScriptRoot 'data\morning.log'
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===" | Out-File $log -Append -Encoding utf8
foreach ($step in @(@('pull.py', '3'), @('history.py', '7'), @('history.py', '--backfill'), @('variants\extract.py'))) {
    & $py @step *>&1 | Out-File $log -Append -Encoding utf8
    "$($step -join ' ') exit $LASTEXITCODE" | Out-File $log -Append -Encoding utf8
}
Get-Content $log -Tail 12
