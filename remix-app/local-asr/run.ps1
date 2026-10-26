$ErrorActionPreference = "Stop"

$tokenPath = Join-Path $PSScriptRoot ".asr-token"
$servicePath = Join-Path $PSScriptRoot "server.py"
$pythonPath = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$requirementsPath = Join-Path $PSScriptRoot "requirements-cpu.txt"

foreach ($path in @($pythonPath, $requirementsPath, $servicePath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required file not found: $path. Create the Python 3.12 environment and install requirements-cpu.txt first."
    }
}

$ffmpegPath = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
$ffprobePath = (Get-Command ffprobe -ErrorAction SilentlyContinue).Source
if (-not $ffmpegPath -or -not $ffprobePath) {
    $wingetPackageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (Test-Path -LiteralPath $wingetPackageRoot -PathType Container) {
        if (-not $ffmpegPath) {
            $ffmpegPath = Get-ChildItem -LiteralPath $wingetPackageRoot -Filter ffmpeg.exe -File -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty FullName
        }
        if (-not $ffprobePath) {
            $ffprobePath = Get-ChildItem -LiteralPath $wingetPackageRoot -Filter ffprobe.exe -File -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty FullName
        }
    }
}
if (-not $ffmpegPath -or -not $ffprobePath) {
    throw "FFmpeg and ffprobe are required. Install FFmpeg and reopen PowerShell."
}

if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    $bytes = [byte[]]::new(48)
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($bytes)
    } finally {
        $random.Dispose()
    }
    $token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
    [System.IO.File]::WriteAllText($tokenPath, $token, [System.Text.Encoding]::ASCII)
}

$env:ASR_TOKEN = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
$env:FFMPEG_PATH = $ffmpegPath
$env:FFPROBE_PATH = $ffprobePath
$env:ASR_HOST = "127.0.0.1"
$env:ASR_PORT = "8765"

Write-Host "Starting local SenseVoice API on 127.0.0.1:8765"
Write-Host "FunASR will load SenseVoiceSmall on CPU. Keep this window open while the service is in use."
Write-Host "The API token is stored at $tokenPath"
& $pythonPath $servicePath
