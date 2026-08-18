# tests/Ui.Tests.ps1
BeforeAll { . "$PSScriptRoot/../lib/Ui.ps1" }

Describe 'Format-StepLine' {
    It 'đánh số bước theo dạng [n/tổng]' {
        Format-StepLine -Number 3 -Total 8 -Text 'Kiểm tra GPU' | Should -Be '[3/8] Kiểm tra GPU'
    }
    It 'giữ nguyên dấu tiếng Việt' {
        Format-StepLine -Number 1 -Total 8 -Text 'Đang khởi động…' | Should -Be '[1/8] Đang khởi động…'
    }
}

Describe 'Initialize-Ui' {
    It 'đặt output encoding về UTF-8' {
        Initialize-Ui
        [Console]::OutputEncoding.WebName | Should -Be 'utf-8'
    }
}

Describe 'Get-TranscriptPath' {
    It 'đặt file dưới logs/ với dấu thời gian sắp xếp được' {
        $p = Get-TranscriptPath -Root 'C:\app' -When ([datetime]'2026-08-18T09:05:00')
        $p | Should -Be 'C:\app\logs\setup-20260818-090500.log'
    }
    It 'hai lần gọi khác thời điểm cho hai file khác nhau' {
        $a = Get-TranscriptPath -Root 'C:\app' -When ([datetime]'2026-08-18T09:05:00')
        $b = Get-TranscriptPath -Root 'C:\app' -When ([datetime]'2026-08-18T09:05:01')
        $a | Should -Not -Be $b
    }
}