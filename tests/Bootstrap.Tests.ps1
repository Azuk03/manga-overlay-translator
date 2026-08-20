BeforeAll { . "$PSScriptRoot/../bootstrap.ps1" -AsModule }

Describe 'Get-PreservedNames' {
    It 'giữ .env — nếu mất thì người dùng phải nhập lại khoá API' {
        Get-PreservedNames | Should -Contain '.env'
    }
    It 'giữ marker hash để không build lại 30 phút vô cớ' {
        Get-PreservedNames | Should -Contain '.docker-image-hash'
    }
    It 'giữ result/ và logs/' {
        Get-PreservedNames | Should -Contain 'result'
        Get-PreservedNames | Should -Contain 'logs'
    }
}

Describe 'Copy-ReleaseTree' {
    BeforeEach {
        $script:src = Join-Path $TestDrive ([guid]::NewGuid())
        $script:dst = Join-Path $TestDrive ([guid]::NewGuid())
        New-Item -ItemType Directory $src -Force | Out-Null
        New-Item -ItemType Directory $dst -Force | Out-Null
        Set-Content (Join-Path $src 'setup.ps1') 'moi' -Encoding UTF8
    }
    It 'ghi đè file mã nguồn bằng bản mới' {
        Set-Content (Join-Path $dst 'setup.ps1') 'cu' -Encoding UTF8
        Copy-ReleaseTree -SourceDir $src -TargetDir $dst -PreserveNames (Get-PreservedNames)
        (Get-Content (Join-Path $dst 'setup.ps1') -Raw).Trim() | Should -Be 'moi'
    }
    It 'KHÔNG đụng tới .env đã có' {
        Set-Content (Join-Path $dst '.env') 'OPENAI_API_KEY=sk-cua-toi' -Encoding UTF8
        Copy-ReleaseTree -SourceDir $src -TargetDir $dst -PreserveNames (Get-PreservedNames)
        (Get-Content (Join-Path $dst '.env') -Raw).Trim() | Should -Be 'OPENAI_API_KEY=sk-cua-toi'
    }
    It 'không nổ khi thư mục đích trống (cài mới)' {
        { Copy-ReleaseTree -SourceDir $src -TargetDir $dst -PreserveNames (Get-PreservedNames) } | Should -Not -Throw
        Test-Path (Join-Path $dst 'setup.ps1') | Should -BeTrue
    }
}
