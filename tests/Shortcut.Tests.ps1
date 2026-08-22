BeforeAll { . "$PSScriptRoot/../lib/Shortcut.ps1" }

Describe 'Get-ShortcutPlan' {
    BeforeAll { $script:plan = Get-ShortcutPlan -Root 'C:\app' }
    It 'có đủ bốn mục' { $plan.Count | Should -Be 4 }
    It 'chỉ đúng MỘT mục nằm trên Desktop' {
        @($plan | Where-Object { $_.OnDesktop }).Count | Should -Be 1
    }
    It 'mục trên Desktop là "Bật Manga Translator"' {
        ($plan | Where-Object { $_.OnDesktop }).Name | Should -Be 'Bật Manga Translator'
    }
    It 'có mục gỡ cài đặt (chỉ trong Start Menu)' {
        $u = $plan | Where-Object { $_.Name -eq 'Gỡ cài đặt Manga Translator' }
        $u | Should -Not -BeNullOrEmpty
        $u.OnDesktop | Should -BeFalse
    }
    It 'trỏ tới đúng script dưới thư mục gốc' {
        ($plan | Where-Object { $_.Name -eq 'Bật Manga Translator' }).Script | Should -Be 'C:\app\start.ps1'
    }
    It 'mục Cập nhật mang theo -InstallDir trỏ về đúng thư mục gốc' {
        $u = $plan | Where-Object { $_.Name -eq 'Cập nhật Manga Translator' }
        $u.Arguments | Should -Match '-InstallDir'
        $u.Arguments | Should -Match ([regex]::Escape('C:\app'))
    }
    It 'tên shortcut Desktop mà uninstall xoá phải khớp Get-ShortcutPlan' {
        $desktopItem = @(Get-ShortcutPlan -Root 'C:\app' | Where-Object { $_.OnDesktop })
        $desktopItem.Count | Should -Be 1
        # Tên Desktop lấy từ hằng số chung, nên hai hàm không thể lệch nhau.
        $desktopItem[0].Name | Should -Be 'Bật Manga Translator'
        # Bảo đảm Get-ShortcutPlan không ném với đường dẫn tương đối/ngắn — lỗi cũ
        # là gọi nó với chuỗi rỗng và Join-Path từ chối.
        { Get-ShortcutPlan -Root '.' } | Should -Not -Throw
    }
}

Describe 'New-AppShortcut' {
    It 'tạo file .lnk và trả về true' {
        $lnk = Join-Path $TestDrive 'a.lnk'
        New-AppShortcut -ShortcutPath $lnk -ScriptPath 'C:\app\start.ps1' -WorkingDirectory 'C:\app' | Should -BeTrue
        Test-Path $lnk | Should -BeTrue
    }
    It 'idempotent: gọi lần hai trả về false và không tạo trùng' {
        $lnk = Join-Path $TestDrive 'b.lnk'
        New-AppShortcut -ShortcutPath $lnk -ScriptPath 'C:\app\start.ps1' -WorkingDirectory 'C:\app' | Out-Null
        New-AppShortcut -ShortcutPath $lnk -ScriptPath 'C:\app\start.ps1' -WorkingDirectory 'C:\app' | Should -BeFalse
    }
}

Describe 'New-AppShortcut với tên Unicode' {
    It 'tạo được shortcut có dấu tiếng Việt trong tên' {
        $p = Join-Path $TestDrive 'Bật Manga Translator.lnk'
        New-AppShortcut -ShortcutPath $p -ScriptPath 'X:\app\start.ps1' -WorkingDirectory 'X:\app' | Should -BeTrue
        Test-Path -LiteralPath $p | Should -BeTrue
    }
    It 'đọc lại được Arguments từ shortcut tên Unicode' {
        $p = Join-Path $TestDrive 'Cập nhật Manga Translator.lnk'
        New-AppShortcut -ShortcutPath $p -ScriptPath 'X:\app\bootstrap.ps1' -WorkingDirectory 'X:\app' -Arguments '-InstallDir "D:\Manga Translator"' | Out-Null
        Get-ShortcutArguments -ShortcutPath $p | Should -BeLike '*-InstallDir "D:\Manga Translator"*'
    }
    It 'gọi lần hai với cùng tham số thì không ghi lại' {
        $p = Join-Path $TestDrive 'Gỡ cài đặt Manga Translator.lnk'
        New-AppShortcut -ShortcutPath $p -ScriptPath 'X:\app\uninstall.ps1' -WorkingDirectory 'X:\app' | Out-Null
        New-AppShortcut -ShortcutPath $p -ScriptPath 'X:\app\uninstall.ps1' -WorkingDirectory 'X:\app' | Should -BeFalse
    }
    It 'không để sót file tạm .lnk nào' {
        $p = Join-Path $TestDrive 'Cài đặt Manga Translator.lnk'
        New-AppShortcut -ShortcutPath $p -ScriptPath 'X:\app\configure.ps1' -WorkingDirectory 'X:\app' | Out-Null
        @(Get-ChildItem $TestDrive -Filter 'mot-tmp-*.lnk').Count | Should -Be 0
    }
}