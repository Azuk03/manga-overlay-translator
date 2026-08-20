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

# Bo tien to \\?\ ma WSL them vao BasePath trong registry.
function ConvertFrom-WslBasePath {
    param([string]$BasePath)
    if ([string]::IsNullOrWhiteSpace($BasePath)) { return '' }
    return ($BasePath -replace '^\\\\\?\\', '')
}

# Tra ve thu muc Docker Desktop THAT SU dung de chua du lieu (anh ~16GB
# nam trong file .vhdx o day). KHONG duoc gia dinh %LOCALAPPDATA%: Docker
# Desktop cho phep doi cho, va nguoi dung o C: chat thuong doi that.
function Get-DockerDataPath {
    try {
        $lxss = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction SilentlyContinue
        foreach ($k in $lxss) {
            $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
            if ($p.DistributionName -like 'docker-desktop*' -and $p.BasePath) {
                return (ConvertFrom-WslBasePath -BasePath $p.BasePath)
            }
        }
    } catch { }
    try {
        $f = Join-Path $env:APPDATA 'Docker\settings-store.json'
        if (Test-Path $f) {
            $j = Get-Content $f -Raw | ConvertFrom-Json
            if ($j.PSObject.Properties.Name -contains 'CustomWslDistroDir' -and $j.CustomWslDistroDir) {
                return $j.CustomWslDistroDir
            }
        }
    } catch { }
    return (Join-Path $env:LOCALAPPDATA 'Docker')
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
