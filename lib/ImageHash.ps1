function Get-DockerImageHash {
    param(
        [string]$DockerfilePath,
        [string]$PatchesDir
    )

    $files = @(Get-Item $DockerfilePath) + (Get-ChildItem $PatchesDir -File -Recurse | Sort-Object FullName)

    $combined = New-Object System.Text.StringBuilder
    foreach ($file in $files) {
        [void]$combined.Append((Get-Content $file.FullName -Raw))
    }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($combined.ToString())
    $hashBytes = $sha256.ComputeHash($bytes)
    return [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLower()
}

function Test-NeedsRebuild {
    param(
        [string]$CurrentHash,
        [string]$MarkerPath
    )

    if (-not (Test-Path $MarkerPath)) { return $true }

    $storedHash = (Get-Content $MarkerPath -Raw).Trim()
    return ($storedHash -ne $CurrentHash)
}

function Set-ImageHashMarker {
    param(
        [string]$Hash,
        [string]$MarkerPath
    )

    Set-Content -Path $MarkerPath -Value $Hash -NoNewline
}
