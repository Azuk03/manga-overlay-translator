$script:StartMenuFolderName = 'Manga Translator'
$script:DesktopShortcutName = 'Bật Manga Translator'

function Get-ShortcutPlan {
    param([string]$Root)
    $result = @(
        [pscustomobject]@{ Name = $script:DesktopShortcutName; Script = (Join-Path $Root 'start.ps1');     OnDesktop = $true;  Arguments = '' },
        [pscustomobject]@{ Name = 'Cài đặt Manga Translator';  Script = (Join-Path $Root 'configure.ps1'); OnDesktop = $false; Arguments = '' },
        # Cập nhật phải cài lại đúng chỗ cũ: bootstrap.ps1 không có -InstallDir
        # thì tự rơi về %LOCALAPPDATA%\MangaTranslator, tạo bản cài song song
        # nếu người dùng ban đầu chọn ổ khác.
        [pscustomobject]@{ Name = 'Cập nhật Manga Translator'; Script = (Join-Path $Root 'bootstrap.ps1'); OnDesktop = $false; Arguments = "-InstallDir `"$Root`"" },
        [pscustomobject]@{ Name = 'Gỡ cài đặt Manga Translator'; Script = (Join-Path $Root 'uninstall.ps1'); OnDesktop = $false; Arguments = '' }
    )
    return $result
}

function New-AppShortcut {
    param([string]$ShortcutPath, [string]$ScriptPath, [string]$WorkingDirectory, [string]$Arguments = '')
    $argsStr = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
    if ($Arguments) { $argsStr += " $Arguments" }
    $shell = New-Object -ComObject WScript.Shell
    # Sua hong: truoc day ham nay tra ve som neu .lnk da ton tai, nen shortcut
    # cu (vd tro sai -InstallDir tu ban cai truoc) khong bao gio duoc sua lai.
    # Gio doc Arguments hien co va chi ghi lai neu no khac voi gia tri dung.
    $sc = $shell.CreateShortcut($ShortcutPath)
    $isNew = -not (Test-Path $ShortcutPath)
    if (-not $isNew -and $sc.Arguments -eq $argsStr) { return $false }
    $sc.TargetPath = 'powershell.exe'
    $sc.Arguments = $argsStr
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
        New-AppShortcut -ShortcutPath (Join-Path $startMenu "$($item.Name).lnk") -ScriptPath $item.Script -WorkingDirectory $Root -Arguments $item.Arguments | Out-Null
        if ($item.OnDesktop) {
            New-AppShortcut -ShortcutPath (Join-Path $desktop "$($item.Name).lnk") -ScriptPath $item.Script -WorkingDirectory $Root -Arguments $item.Arguments | Out-Null
        }
    }
}

function Remove-AppShortcuts {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) $script:StartMenuFolderName
    # Tên lấy từ cùng một hằng số với Get-ShortcutPlan, nên hai bên không
    # thể lệch nhau, và không cần truyền Root giả vào đây.
    Remove-Item (Join-Path $desktop ($script:DesktopShortcutName + '.lnk')) -ErrorAction SilentlyContinue
    Remove-Item $startMenu -Recurse -Force -ErrorAction SilentlyContinue
}