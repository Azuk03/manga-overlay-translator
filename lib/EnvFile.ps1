function Get-EnvApiKey {
    param([string]$EnvPath)

    if (-not (Test-Path $EnvPath)) { return $null }

    $line = Get-Content $EnvPath | Where-Object { $_ -match '^\s*OPENAI_API_KEY\s*=\s*(.+)$' } | Select-Object -First 1
    if (-not $line) { return $null }

    $value = ($line -replace '^\s*OPENAI_API_KEY\s*=\s*', '').Trim()
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }

    return $value
}

function Set-EnvApiKey {
    param(
        [string]$EnvPath,
        [string]$EnvExamplePath,
        [string]$ApiKey
    )

    if (-not (Test-Path $EnvPath)) {
        Copy-Item $EnvExamplePath $EnvPath
    }

    $lines = Get-Content $EnvPath
    $found = $false
    $newLines = foreach ($line in $lines) {
        if ($line -match '^\s*OPENAI_API_KEY\s*=') {
            $found = $true
            "OPENAI_API_KEY=$ApiKey"
        } else {
            $line
        }
    }

    if (-not $found) {
        $newLines += "OPENAI_API_KEY=$ApiKey"
    }

    Set-Content -Path $EnvPath -Value $newLines
}
