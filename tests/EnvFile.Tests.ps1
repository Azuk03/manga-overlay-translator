# tests/EnvFile.Tests.ps1
BeforeAll { . "$PSScriptRoot/../lib/EnvFile.ps1" }

Describe 'Read-EnvFile' {
    It 'đọc cặp khoá-giá trị, bỏ qua comment và dòng trống' {
        $p = Join-Path $TestDrive 'a.env'
        Set-Content $p @('# ghi chú', '', 'OPENAI_API_KEY=sk-abc', 'OPENAI_MODEL=gpt-4o') -Encoding UTF8
        $v = Read-EnvFile -Path $p
        $v['OPENAI_API_KEY'] | Should -Be 'sk-abc'
        $v['OPENAI_MODEL']   | Should -Be 'gpt-4o'
        $v.Count | Should -Be 2
    }
    It 'giữ nguyên dấu = nằm trong giá trị' {
        $p = Join-Path $TestDrive 'b.env'
        Set-Content $p @('OPENAI_API_BASE=https://x.y/v1?a=b') -Encoding UTF8
        (Read-EnvFile -Path $p)['OPENAI_API_BASE'] | Should -Be 'https://x.y/v1?a=b'
    }
    It 'trả hashtable rỗng khi file không tồn tại' {
        (Read-EnvFile -Path (Join-Path $TestDrive 'khong-co.env')).Count | Should -Be 0
    }
}

Describe 'Set-EnvValue' {
    It 'thay giá trị mà KHÔNG xoá comment hay đổi thứ tự dòng' {
        $p = Join-Path $TestDrive 'c.env'
        Set-Content $p @('# đầu file', 'OPENAI_API_KEY=cu', '# giữa', 'OPENAI_MODEL=gpt-4o') -Encoding UTF8
        Set-EnvValue -Path $p -Key 'OPENAI_API_KEY' -Value 'moi'
        $lines = Get-Content $p
        $lines[0] | Should -Be '# đầu file'
        $lines[1] | Should -Be 'OPENAI_API_KEY=moi'
        $lines[2] | Should -Be '# giữa'
        $lines[3] | Should -Be 'OPENAI_MODEL=gpt-4o'
    }
    It 'thêm khoá mới vào cuối nếu chưa có' {
        $p = Join-Path $TestDrive 'd.env'
        Set-Content $p @('OPENAI_API_KEY=x') -Encoding UTF8
        Set-EnvValue -Path $p -Key 'DEEPL_AUTH_KEY' -Value 'dk'
        (Read-EnvFile -Path $p)['DEEPL_AUTH_KEY'] | Should -Be 'dk'
    }
    It 'ghi giá trị rỗng vẫn giữ dòng khoá (để làm tài liệu)' {
        $p = Join-Path $TestDrive 'e.env'
        Set-Content $p @('GEMINI_API_KEY=cu') -Encoding UTF8
        Set-EnvValue -Path $p -Key 'GEMINI_API_KEY' -Value ''
        @(Get-Content $p)[0] | Should -Be 'GEMINI_API_KEY='
    }
}
