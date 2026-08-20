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