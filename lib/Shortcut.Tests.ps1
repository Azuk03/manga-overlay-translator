BeforeAll {
    . "$PSScriptRoot/Shortcut.ps1"
}

Describe "New-DesktopShortcut" {
    It "creates a .lnk file and returns true when it does not exist yet" {
        $shortcutPath = "$TestDrive/Bat Manga Translator.lnk"
        $created = New-DesktopShortcut -ShortcutPath $shortcutPath -TargetPath "powershell.exe" -Arguments "-NoExit -File test.ps1" -WorkingDirectory $TestDrive
        $created | Should -BeTrue
        Test-Path $shortcutPath | Should -BeTrue
    }

    It "returns false and does not error when the shortcut already exists" {
        $shortcutPath = "$TestDrive/Existing.lnk"
        New-DesktopShortcut -ShortcutPath $shortcutPath -TargetPath "powershell.exe" -Arguments "-NoExit" -WorkingDirectory $TestDrive | Out-Null
        $secondResult = New-DesktopShortcut -ShortcutPath $shortcutPath -TargetPath "powershell.exe" -Arguments "-NoExit" -WorkingDirectory $TestDrive
        $secondResult | Should -BeFalse
    }
}
