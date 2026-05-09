$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $root ".state"
$stateFile = Join-Path $stateDir "last-run.txt"

if (-not (Test-Path $stateDir)) {
    New-Item -ItemType Directory -Path $stateDir | Out-Null
}

$madridTz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Romance Standard Time")
$madridNow = [System.TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $madridTz)

if ($madridNow.Day -ne 1 -or $madridNow.Hour -ne 12) {
    Write-Host "Fuera de ventana Madrid: $($madridNow.ToString('yyyy-MM-dd HH:mm:ss'))"
    exit 0
}

$periodKey = $madridNow.ToString("yyyy-MM")
if (Test-Path $stateFile) {
    $lastRun = (Get-Content $stateFile -Raw).Trim()
    if ($lastRun -eq $periodKey) {
        Write-Host "Ya ejecutado para $periodKey"
        exit 0
    }
}

Push-Location $root
try {
    node src/marangatu.js
    if ($LASTEXITCODE -ne 0) {
        throw "La automatizacion fallo con codigo $LASTEXITCODE"
    }
    Set-Content -Path $stateFile -Value $periodKey -NoNewline
}
finally {
    Pop-Location
}
