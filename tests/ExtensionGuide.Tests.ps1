BeforeAll {
    . "$PSScriptRoot/../lib/BrowserDetect.ps1"
    . "$PSScriptRoot/../lib/ExtensionGuide.ps1"
}

Describe 'Get-GuideSteps' {
    BeforeAll { $script:steps = Get-GuideSteps -ExtensionPath 'C:\app\extension' }
    It 'có đúng bốn bước' { $steps.Count | Should -Be 4 }
    It 'bước cuối là kiểm chứng bằng nút Test kết nối của popup' {
        $steps[3] | Should -BeLike '*Test kết nối*'
    }
    It 'nhắc bật Developer mode ở bước đầu' { $steps[0] | Should -BeLike '*Developer mode*' }
    It 'nhúng đúng đường dẫn extension vào bước chọn thư mục' {
        $steps[2] | Should -BeLike '*C:\app\extension*'
    }
}