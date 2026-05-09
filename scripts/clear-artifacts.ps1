$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$artifactsDir = Join-Path $root "artifacts"

if (-not (Test-Path $artifactsDir)) {
    Write-Host "No artifacts directory found."
    exit 0
}

$resolvedRoot = (Resolve-Path $root).Path
$resolvedArtifacts = (Resolve-Path $artifactsDir).Path

if (-not $resolvedArtifacts.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to delete outside project: $resolvedArtifacts"
}

Get-ChildItem -LiteralPath $resolvedArtifacts -Force | Remove-Item -Recurse -Force
Write-Host "Artifacts cleared: $resolvedArtifacts"
