function Read-EnvFile {
    param([string]$Path)
    $result = @{}
    if (-not (Test-Path $Path)) { return $result }
    foreach ($raw in (Get-Content $Path -Encoding UTF8)) {
        $line = $raw.Trim()
        if (-not $line) { continue }
        if ($line.StartsWith('#')) { continue }
        $idx = $line.IndexOf('=')
        if ($idx -lt 1) { continue }
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()
        if ($val) { $result[$key] = $val }
    }
    return $result
}

function Set-EnvValue {
    param([string]$Path, [string]$Key, [string]$Value)
    $lines = @()
    if (Test-Path $Path) { $lines = @(Get-Content $Path -Encoding UTF8) }
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=") {
            $found = $true
            "$Key=$Value"
        } else {
            $line
        }
    }
    if (-not $found) { $out = @($out) + "$Key=$Value" }
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    $writer = New-Object System.IO.StreamWriter($full, $false, $encoding)
    try {
        foreach ($line in $out) {
            $writer.WriteLine($line)
        }
    } finally {
        $writer.Close()
    }
}

function Initialize-EnvFile {
    param([string]$Path, [string]$ExamplePath)
    if (-not (Test-Path $Path)) { Copy-Item $ExamplePath $Path }
}
