$ErrorActionPreference = "Stop"

$taskName = "Impuestos Paraguay Marangatu"
$scriptPath = Join-Path $PSScriptRoot "run-monthly-check.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date
$trigger.RepetitionInterval = New-TimeSpan -Minutes 30
$trigger.RepetitionDuration = New-TimeSpan -Days 3650

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Revisa cada 30 minutos si corresponde presentar formularios de impuestos en Paraguay a las 12:00 de Madrid el dia 1."
