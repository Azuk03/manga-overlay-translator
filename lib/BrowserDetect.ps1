$script:KnownBrowsers = @(
    @{ Exe = 'chrome.exe';  Name = 'Google Chrome' },
    @{ Exe = 'msedge.exe';  Name = 'Microsoft Edge' },
    @{ Exe = 'browser.exe'; Name = 'Cốc Cốc' },
    @{ Exe = 'brave.exe';   Name = 'Brave' },
    @{ Exe = 'vivaldi.exe'; Name = 'Vivaldi' }
)

function Get-BrowserListFromPaths {
    param([hashtable]$PathsByExe)
    $out = @()
    # Duyệt theo thứ tự KnownBrowsers để Chrome luôn đứng đầu.
    foreach ($b in $script:KnownBrowsers) {
        if ($PathsByExe.ContainsKey($b.Exe) -and $PathsByExe[$b.Exe]) {
            $out += [pscustomobject]@{ Name = $b.Name; Path = $PathsByExe[$b.Exe] }
        }
    }
    return $out
}

function Get-InstalledBrowsers {
    $paths = @{}
    foreach ($b in $script:KnownBrowsers) {
        foreach ($hive in @('HKLM:', 'HKCU:')) {
            $key = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$($b.Exe)"
            if (Test-Path $key) {
                $v = (Get-ItemProperty $key).'(default)'
                if ($v -and -not $paths.ContainsKey($b.Exe)) { $paths[$b.Exe] = $v }
            }
        }
    }
    return Get-BrowserListFromPaths -PathsByExe $paths
}

function Open-UrlInBrowser {
    param([string]$BrowserPath, [string]$Url)
    # Phải gọi thẳng exe: Start-Process 'chrome://extensions' với browser mặc
    # định KHÔNG mở được scheme chrome://.
    Start-Process -FilePath $BrowserPath -ArgumentList $Url
}