function Get-FreeSpaceGb {
    param([string]$Path)
    $drive = (Split-Path -Qualifier $Path).TrimEnd(':')
    $d = Get-PSDrive -Name $drive
    return [math]::Round($d.Free / 1GB, 1)
}

function Test-EnoughDisk {
    param([double]$FreeGb, [double]$RequiredGb)
    return ($FreeGb -ge $RequiredGb)
}

function Get-VramMbFromSmiOutput {
    param([string]$Text)
    if ($Text -match '(\d+)\s*MiB') { return [int]$Matches[1] }
    return 0
}

function Test-DockerDaemonReady {
    docker version 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-NvidiaGpu {
    nvidia-smi 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-WingetAvailable {
    return ($null -ne (Get-Command winget -ErrorAction SilentlyContinue))
}

function Start-DockerDesktop {
    foreach ($p in @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
                     "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe")) {
        if (Test-Path $p) { Start-Process $p; return $true }
    }
    return $false
}

function Wait-DockerDaemon {
    param([int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-DockerDaemonReady) { return $true }
        Start-Sleep -Seconds 5
    }
    return $false
}
