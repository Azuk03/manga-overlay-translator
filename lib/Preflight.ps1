function Get-FreeSpaceGb {
    param([string]$Path)
    $qualifier = Split-Path -Qualifier $Path -ErrorAction SilentlyContinue
    if (-not $qualifier) {
        throw "Không xác định được ổ đĩa từ đường dẫn: $Path"
    }
    $d = Get-PSDrive -Name $qualifier.TrimEnd(':')
    return [math]::Round($d.Free / 1GB, 1)
}

function Test-EnoughDisk {
    param([double]$FreeGb, [double]$RequiredGb)
    return ($FreeGb -ge $RequiredGb)
}

function Get-VramMbFromSmiOutput {
    param([string]$Text)
    $found = [regex]::Matches($Text, '(\d+)\s*MiB')
    if ($found.Count -eq 0) { return 0 }
    $best = 0
    foreach ($m in $found) {
        $v = [int]$m.Groups[1].Value
        if ($v -gt $best) { $best = $v }
    }
    return $best
}

function Test-DockerDaemonReady {
    try {
        docker version 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Test-NvidiaGpu {
    try {
        nvidia-smi 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
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
