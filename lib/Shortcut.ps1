$script:StartMenuFolderName = 'Manga Translator'

function Get-ShortcutPlan {
    param([string]$Root)
    $result = @(
        [pscustomobject]@{ Name = 'Bật Manga Translator';      Script = (Join-Path $Root 'start.ps1');     OnDesktop = $true  },
        [pscustomobject]@{ Name = 'Cài đặt Manga Translator';  Script = (Join-Path $Root 'configure.ps1'); OnDesktop = $false },
        [pscustomobject]@{ Name = 'Cập nhật Manga Translator'; Script = (Join-Path $Root 'bootstrap.ps1'); OnDesktop = $false },
        [pscustomobject]@{ Name = 'Gỡ cài đặt Manga Translator'; Script = (Join-Path $Root 'uninstall.ps1'); OnDesktop = $false }
    )
    return $result
}

function New-AppShortcut {
    param([string]$ShortcutPath, [string]$ScriptPath, [string]$WorkingDirectory)
    if (Test-Path $ShortcutPath) { return $false }
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($ShortcutPath)
    $sc.TargetPath = 'powershell.exe'
    $sc.Arguments = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
    $sc.WorkingDirectory = $WorkingDirectory
    $sc.Save()
    return $true
}

function Install-Shortcuts {
    param([string]$Root)
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) $script:StartMenuFolderName
    New-Item -ItemType Directory $startMenu -Force | Out-Null
    foreach ($item in (Get-ShortcutPlan -Root $Root)) {
        New-AppShortcut -ShortcutPath (Join-Path $startMenu "$($item.Name).lnk") -ScriptPath $item.Script -WorkingDirectory $Root | Out-Null
        if ($item.OnDesktop) {
            New-AppShortcut -ShortcutPath (Join-Path $desktop "$($item.Name).lnk") -ScriptPath $item.Script -WorkingDirectory $Root | Out-Null
        }
    }
}

function Remove-AppShortcuts {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) $script:StartMenuFolderName
    # Lấy tên từ Get-ShortcutPlan thay vì lặp lại chuỗi: đổi tên ở một chỗ
    # là đủ, không để uninstall bỏ sót shortcut Desktop.
    foreach ($item in (Get-ShortcutPlan -Root '')) {
        if ($item.OnDesktop) {
            Remove-Item (Join-Path $desktop ($item.Name + '.lnk')) -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $startMenu -Recurse -Force -ErrorAction SilentlyContinue
}