function Get-SourceHash {
    param([string]$DockerfilePath, [string]$PatchesDir)
    $parts = @((Get-FileHash $DockerfilePath -Algorithm SHA256).Hash)
    # Sort by name for stable hash across machines
    foreach ($f in (Get-ChildItem $PatchesDir -File | Sort-Object Name)) {
        $parts += $f.Name
        $parts += (Get-FileHash $f.FullName -Algorithm SHA256).Hash
    }
    $joined = [System.Text.Encoding]::UTF8.GetBytes(($parts -join '|'))
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha.ComputeHash($joined))).Replace('-', '')
}

function Save-ImageHashMarker {
    param([string]$Hash, [string]$MarkerPath)
    Set-Content -Path $MarkerPath -Value $Hash -Encoding UTF8
}

function Test-NeedsRebuild {
    param([string]$CurrentHash, [string]$MarkerPath, [bool]$ImageExists)
    # Image can be deleted manually while marker still exists
    if (-not $ImageExists) { return $true }
    if (-not (Test-Path $MarkerPath)) { return $true }
    return ((Get-Content $MarkerPath -Raw).Trim() -ne $CurrentHash)
}

function Test-DockerImageExists {
    param([string]$ImageName)
    docker image inspect $ImageName 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Invoke-ImageBuild {
    param([string]$Root, [string]$ImageName)
    $log = Join-Path $Root 'logs/docker-build.log'
    New-Item -ItemType Directory (Split-Path $log) -Force | Out-Null
    Push-Location $Root
    docker build -t $ImageName . 2>&1 | Tee-Object -FilePath $log
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) {
        Write-Err 'Build image failed. Last 20 lines of log:'
        Get-Content $log -Tail 20 | ForEach-Object { Write-Host "    $_" }
        return $false
    }
    return $true
}
