# tests/ConfigDialog.Tests.ps1
BeforeAll {
    . "$PSScriptRoot/../lib/EnvFile.ps1"
    . "$PSScriptRoot/../lib/ConfigDialog.ps1"
}

Describe 'Test-KeyFormat' {
    It 'nhận khoá bắt đầu bằng sk-' { Test-KeyFormat -Key 'sk-abc123' | Should -BeTrue }
    It 'từ chối khoá rỗng' { Test-KeyFormat -Key '' | Should -BeFalse }
    It 'từ chối khoá sai tiền tố' { Test-KeyFormat -Key 'abc123' | Should -BeFalse }
    It 'bỏ qua khoảng trắng thừa hai đầu' { Test-KeyFormat -Key '  sk-abc  ' | Should -BeTrue }
}

Describe 'Get-KeyCheckVerdict' {
    It '200 là khoá dùng được' { Get-KeyCheckVerdict -StatusCode 200 -NetworkFailed $false | Should -Be 'ok' }
    It '401 là khoá sai' { Get-KeyCheckVerdict -StatusCode 401 -NetworkFailed $false | Should -Be 'invalid' }
    It 'lỗi mạng phân biệt hẳn với khoá sai' { Get-KeyCheckVerdict -StatusCode 0 -NetworkFailed $true | Should -Be 'network' }
    It 'mã lạ trả unknown chứ không đoán bừa' { Get-KeyCheckVerdict -StatusCode 500 -NetworkFailed $false | Should -Be 'unknown' }
}

Describe 'Test-OpenAiKey' {
    It 'dùng Invoker được tiêm vào, không gọi mạng thật' {
        $r = Test-OpenAiKey -Key 'sk-x' -BaseUrl 'https://api.openai.com/v1' -Invoker { param($k, $u) return 200 }
        $r | Should -Be 'ok'
    }
    It 'báo invalid khi Invoker trả 401' {
        Test-OpenAiKey -Key 'sk-x' -BaseUrl 'https://api.openai.com/v1' -Invoker { param($k, $u) return 401 } | Should -Be 'invalid'
    }
    It 'báo network khi Invoker ném lỗi' {
        Test-OpenAiKey -Key 'sk-x' -BaseUrl 'https://api.openai.com/v1' -Invoker { param($k, $u) throw 'khong ket noi duoc' } | Should -Be 'network'
    }
}

Describe 'Save-ConfigToEnv' {
    It 'ghi mọi khoá và giữ nguyên comment sẵn có' {
        $p = Join-Path $TestDrive 'f.env'
        Set-Content $p @('# ghi chú quan trọng', 'OPENAI_API_KEY=') -Encoding UTF8
        Save-ConfigToEnv -EnvPath $p -Values @{ OPENAI_API_KEY = 'sk-new'; OPENAI_MODEL = 'gpt-4o' }
        (Get-Content $p -Encoding UTF8)[0] | Should -Be '# ghi chú quan trọng'
        (Read-EnvFile -Path $p)['OPENAI_API_KEY'] | Should -Be 'sk-new'
        (Read-EnvFile -Path $p)['OPENAI_MODEL'] | Should -Be 'gpt-4o'
    }
}
