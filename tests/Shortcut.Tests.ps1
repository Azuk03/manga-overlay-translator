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