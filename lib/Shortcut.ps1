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

# WScript.Shell KHONG doc duoc shortcut co ten Unicode (tra ve object rong).
# Shell.Application thi doc duoc - da kiem chung.
function Get-ShortcutArguments {
    param([string]$ShortcutPath)
    try {
        $dir = Split-Path $ShortcutPath -Parent
        $leaf = Split-Path $ShortcutPath -Leaf
        $item = (New-Object -ComObject Shell.Application).Namespace($dir).ParseName($leaf)
        if ($null -eq $item) { return '' }
        return $item.GetLink.Arguments
    } catch {
        return ''
    }
}

function New-AppShortcut {
    param([string]$ShortcutPath, [string]$ScriptPath, [string]$WorkingDirectory, [string]$Arguments = '')
    $wantedArgs = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
    if ($Arguments) { $wantedArgs = $wantedArgs + ' ' + $Arguments }

    # Sua hong: truoc day ham nay tra ve som neu .lnk da ton tai, nen shortcut
    # cu (vd tro sai -InstallDir tu ban cai truoc) khong bao gio duoc sua lai.
    # Gio doc Arguments hien co va chi ghi lai neu no khac voi gia tri dung.
    if (Test-Path -LiteralPath $ShortcutPath) {
        $current = Get-ShortcutArguments -ShortcutPath $ShortcutPath
        if ($current -eq $wantedArgs) { return $false }
    }

    # WScript.Shell chuyen duong dan sang codepage ANSI cua he thong, nen ten
    # co dau tieng Viet bi bien thanh '?' va luu that bai. Cach vong: tao o
    # duong dan ASCII tam roi doi ten bang .NET (xu ly Unicode dung). Da do:
    # file tao ra giong het tung byte voi file tao truc tiep.
    $tempPath = Join-Path (Split-Path $ShortcutPath -Parent) ('mot-tmp-' + [guid]::NewGuid().ToString() + '.lnk')
    try {
        $shell = New-Object -ComObject WScript.Shell
        $sc = $shell.CreateShortcut($tempPath)
        $sc.TargetPath = 'powershell.exe'
        $sc.Arguments = $wantedArgs
        $sc.WorkingDirectory = $WorkingDirectory
        $sc.Save()

        if (Test-Path -LiteralPath $ShortcutPath) { [System.IO.File]::Delete($ShortcutPath) }
        [System.IO.File]::Move($tempPath, $ShortcutPath)
    } finally {
        if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
    }
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