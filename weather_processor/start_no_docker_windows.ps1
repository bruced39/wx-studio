# FREE local NOAA native processor for Windows WITHOUT Docker or paid cloud.
# Run from PowerShell in the wx-studio repository (GitHub ZIP checkout is OK):
#   powershell -ExecutionPolicy Bypass -File .\weather_processor\start_no_docker_windows.ps1 -InstallMicromamba
# After the initial install, run it again without -InstallMicromamba.
# Stops the API/worker when this PowerShell window closes or Ctrl+C is pressed.
[CmdletBinding()]
param(
    [string]$Products = 'mrms-reflectivity,goes-east-conus-C02,nexrad-reflectivity-KBOX',
    [ValidateRange(1024,65535)][int]$Port = 8080,
    [ValidateRange(60,3600)][int]$IntervalSeconds = 120,
    [switch]$InstallMicromamba,
    [switch]$ReinstallEnvironment
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$DataHome = Join-Path $env:LOCALAPPDATA 'WXStudioNOAA'
$Micromamba = Join-Path $DataHome 'micromamba.exe'
$RootPrefix = Join-Path $DataHome 'mamba-root'
$EnvDir = Join-Path $DataHome 'science-env'
$Frames = Join-Path $DataHome 'frames'
$EnvironmentFile = Join-Path $PSScriptRoot 'environment-windows.yaml'
$OfficialDownload = 'https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-win-64'

if ([IntPtr]::Size -ne 8) {
    throw 'A 64-bit Windows PowerShell session is required for the NOAA scientific packages.'
}
if ($Products -notmatch '^[A-Za-z0-9,-]+$') {
    throw 'Products must be comma-separated NOAA identifiers with letters, numbers and hyphens only.'
}
New-Item -ItemType Directory -Force -Path $DataHome, $Frames | Out-Null

if (-not (Test-Path -LiteralPath $Micromamba)) {
    $existing = Get-Command micromamba.exe -ErrorAction SilentlyContinue
    if ($existing) {
        $Micromamba = $existing.Source
    } elseif ($InstallMicromamba) {
        Write-Host 'Downloading FREE portable micromamba from the official mamba-org GitHub release.'
        Write-Host 'No machine-wide installation or Docker is needed.'
        $tempFile = Join-Path $DataHome 'micromamba.download'
        try {
            Invoke-WebRequest -Uri $OfficialDownload -OutFile $tempFile -MaximumRedirection 8
            if ((Get-Item $tempFile).Length -lt 500000) { throw 'Portable installer download is unexpectedly small.' }
            Move-Item -LiteralPath $tempFile -Destination $Micromamba -Force
        } finally {
            Remove-Item -LiteralPath $tempFile -ErrorAction SilentlyContinue
        }
    } else {
        throw 'No micromamba.exe found. Re-run with -InstallMicromamba to download a free, portable installer from mamba-org. Nothing has been installed.'
    }
}
$env:MAMBA_ROOT_PREFIX = $RootPrefix
$Python = Join-Path $EnvDir 'python.exe'

if ($ReinstallEnvironment -and (Test-Path $EnvDir)) {
    throw 'For safety, this script does not delete existing environments. Rename science-env manually if you need a fresh installation.'
}
if (-not (Test-Path -LiteralPath $Python)) {
    Write-Host 'Creating the isolated WX Studio NOAA science environment; first download can take several minutes.'
    Write-Host 'Packages: native GOES HDF5/NetCDF, MRMS ecCodes/GRIB2, NEXRAD Py-ART, and a local read-only API.'
    & $Micromamba create --yes --prefix $EnvDir --file $EnvironmentFile
    if ($LASTEXITCODE -ne 0) {
        throw 'Scientific environment installation failed. No NOAA service was started.'
    }
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw 'The NOAA scientific environment did not create python.exe.'
}

Push-Location $RepoRoot
try {
    # Fail closed if packages are missing: no partial/fake live sources.
    & $Python -c "import fastapi, uvicorn, boto3, xarray, h5netcdf, rasterio, pyproj, cfgrib, eccodes, pyart; print('Scientific dependency check: OK')"
    if ($LASTEXITCODE -ne 0) { throw 'The scientific dependencies are incomplete. NOAA not started.' }
    Write-Host ''
    Write-Host 'WX Studio native NOAA is now starting on THIS PC only (127.0.0.1).'
    Write-Host "Frame storage: $Frames"
    Write-Host "Live sources: $Products"
    Write-Host "Health: http://127.0.0.1:$Port/health"
    Write-Host "Catalog: http://127.0.0.1:$Port/catalog"
    Write-Host 'Leave this window running. Press Ctrl+C to stop both API and NOAA ingest.'
    Write-Host 'In WX Studio, check the Streamlit sidebar: Use free local NOAA processor on this computer.'
    Write-Host ''
    & $Python -m weather_processor.local_host --port $Port --interval $IntervalSeconds --products $Products --data-dir $Frames
    if ($LASTEXITCODE -ne 0) {
        throw "Local NOAA processor stopped with exit code $LASTEXITCODE. Check the log output above."
    }
} finally {
    Pop-Location
}
