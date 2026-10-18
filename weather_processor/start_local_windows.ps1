# WX Studio NOAA native processor — zero cloud hosting fees, Windows PC only.
# Run in PowerShell from the cloned wx-studio repository:
# powershell -ExecutionPolicy Bypass -File .\weather_processor\start_local_windows.ps1
# Docker Desktop Personal (free for eligible personal use) plus WSL2 required.
# NOAA API binds to 127.0.0.1 ONLY, not to an external network interface.
[CmdletBinding()]
param(
    [string]$Products = 'mrms-reflectivity,goes-east-conus-C02,nexrad-reflectivity-KBOX',
    [ValidateRange(1,65535)][int]$Port = 8080,
    [switch]$Rebuild
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ImageName = 'wxstudio-noaa-native-local'
$ContainerName = 'wxstudio-noaa-local'
$VolumeName = 'wxstudio-noaa-frames'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker not found. Install free Docker Desktop Personal with WSL2, start it, then rerun.'
}
& docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker is installed but not running. Start Docker Desktop and wait until ready.'
}
if ($Products -notmatch '^[A-Za-z0-9,-]+$') {
    throw 'Product IDs must be comma separated letters, digits and hyphens.'
}
Push-Location $RepoRoot
try {
    & docker image inspect $ImageName 2>$null | Out-Null
    $imageExists = $LASTEXITCODE -eq 0
    if (-not $imageExists -or $Rebuild) {
        Write-Host 'Building local NOAA science decoder (downloads free scientific packages)...'
        & docker build -f weather_processor/Dockerfile -t $ImageName .
        if ($LASTEXITCODE -ne 0) { throw 'Docker build failed; see the error above.' }
    }
    & docker volume inspect $VolumeName 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        & docker volume create $VolumeName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the local NOAA frames volume.' }
    }
    # Only the WX Studio decoder container is replaced. The persistent
    # locally stored weather frames survive a restart.
    $existing = & docker ps -a --filter "name=^/$ContainerName$" --format '{{.Names}}'
    if ($existing -eq $ContainerName) {
        & docker rm -f $ContainerName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot stop old WX Studio decoder container.' }
    }
    Write-Host "Starting native NOAA decoder, products: $Products"
    & docker run -d --name $ContainerName --restart unless-stopped -p "127.0.0.1:$($Port):8080" -v "$($VolumeName):/data/frames" -e "PORT=8080" -e "WX_PROCESSOR_PRODUCTS=$Products" $ImageName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker cannot start local processor; check logs.' }
} finally {
    Pop-Location
}
Start-Sleep -Seconds 4
$HealthURL = "http://127.0.0.1:$($Port)/health"
Write-Host ""
Write-Host "LOCAL ONLY: $HealthURL"
try {
    $health = Invoke-RestMethod -Uri $HealthURL -TimeoutSec 8
    Write-Host ("NOAA status: " + $health.status + " (fresh products: " + $health.freshProducts + ")")
    if ($health.status -ne 'ready') {
        Write-Host 'First NOAA data downloads/decoding can take time. Waiting is NOT a demo/live claim.'
    }
} catch {
    Write-Warning 'Decoder has not responded yet; check logs. First startup may take time.'
}
Write-Host ''
Write-Host "Logs:    docker logs -f $ContainerName"
Write-Host "Catalog: http://127.0.0.1:$($Port)/catalog"
Write-Host "Stop:    docker stop $ContainerName"
Write-Host 'Open WX Studio on this PC and enable the free local NOAA processor in its sidebar.'
Write-Host 'No paid cloud processor, public tunnel or external server is involved.'
