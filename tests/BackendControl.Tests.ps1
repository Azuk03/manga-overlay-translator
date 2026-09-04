BeforeAll { . "$PSScriptRoot/../lib/BackendControl.ps1" }

Describe 'Build-DockerRunArgs' {
    BeforeAll {
        $script:base = @{ OPENAI_API_KEY = 'sk-abc' }
    }
    It 'adds --gpus all when HasGpu is true' {
        $a = Build-DockerRunArgs -EnvVars $base -HasGpu $true -ContainerName 'c' -ResultDir 'D:\r'
        ($a -join ' ') | Should -BeLike '*--gpus all*'
    }
    It 'does not add --gpus when HasGpu is false' {
        $a = Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r'
        ($a -join ' ') | Should -Not -BeLike '*--gpus*'
    }
    It 'includes --use-gpu only when HasGpu is true' {
        $g = Build-DockerRunArgs -EnvVars $base -HasGpu $true  -ContainerName 'c' -ResultDir 'D:\r'
        $c = Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r'
        $g | Should -Contain '--use-gpu'
        $c | Should -Not -Contain '--use-gpu'
    }
    It 'skips optional variables when they have no value' {
        $a = Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r'
        ($a -join ' ') | Should -Not -BeLike '*GEMINI_API_KEY*'
    }
    It 'does not pass variables that are present but empty (empty overrides app default)' {
        $withEmpty = @{ OPENAI_API_KEY = 'sk-abc'; GEMINI_API_KEY = ''; DEEPL_AUTH_KEY = '' }
        $s = (Build-DockerRunArgs -EnvVars $withEmpty -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r') -join ' '
        $s | Should -Not -BeLike '*GEMINI_API_KEY*'
        $s | Should -Not -BeLike '*DEEPL_AUTH_KEY*'
        $s | Should -BeLike '*OPENAI_API_KEY=sk-abc*'
    }
    It 'passes all 6 variables when env has all of them' {
        $full = @{
            OPENAI_API_KEY = 'sk-abc'; OPENAI_MODEL = 'gpt-4o'
            OPENAI_API_BASE = 'https://x/v1'; GEMINI_API_KEY = 'gk'; GEMINI_MODEL = 'gemini-pro'; DEEPL_AUTH_KEY = 'dk'
        }
        $s = (Build-DockerRunArgs -EnvVars $full -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r') -join ' '
        foreach ($k in $full.Keys) { $s | Should -BeLike "*$k=*" }
    }
    It 'publishes 5003 on localhost only, never on every interface' {
        $a = Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r'
        $a | Should -Contain '127.0.0.1:5003:5003'
        # Backend khong co xac thuc + co /fetch-image nhan URL bat ky: publish
        # tran ra LAN la mo mot SSRF proxy cho ca mang.
        $a | Should -Not -Contain '5003:5003'
    }
    It 'still listens on 0.0.0.0 inside the container so docker-proxy can reach it' {
        $a = Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r'
        $a | Should -Contain '--host=0.0.0.0'
    }
    It 'does not publish 8000/8001 - nothing listens there in this configuration' {
        $s = (Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r') -join ' '
        $s | Should -Not -BeLike '*8000*'
        $s | Should -Not -BeLike '*8001*'
    }
    It 'preserves paths with spaces as single array element' {
        $a = Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'C:\Program Files\r'
        $a | Should -Contain 'C:\Program Files\r:/app/result'
    }
}

Describe 'Hide-Secrets' {
    It 'redacts OPENAI_API_KEY' {
        (Hide-Secrets -Arguments @('-e', 'OPENAI_API_KEY=sk-abc')) | Should -Contain 'OPENAI_API_KEY=***'
    }
    It 'redacts both GEMINI_API_KEY and DEEPL_AUTH_KEY' {
        $r = Hide-Secrets -Arguments @('-e', 'GEMINI_API_KEY=gk', '-e', 'DEEPL_AUTH_KEY=dk')
        $r | Should -Contain 'GEMINI_API_KEY=***'
        $r | Should -Contain 'DEEPL_AUTH_KEY=***'
        ($r -join ' ') | Should -Not -BeLike '*gk*'
        ($r -join ' ') | Should -Not -BeLike '*dk*'
    }
    It 'does not redact non-secret variables' {
        (Hide-Secrets -Arguments @('-e', 'OPENAI_MODEL=gpt-4o')) | Should -Contain 'OPENAI_MODEL=gpt-4o'
    }
    It 'does not touch regular arguments' {
        (Hide-Secrets -Arguments @('run', '--rm', '--name', 'c')) -join ' ' | Should -Be 'run --rm --name c'
    }
}

Describe 'New-BackendLogPath' {
    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('mot-log-' + [guid]::NewGuid())
        New-Item -ItemType Directory $script:root -Force | Out-Null
        $script:dir = Join-Path $script:root 'logs'
    }
    AfterEach {
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'creates logs/ when it does not exist yet' {
        New-BackendLogPath -Root $script:root | Out-Null
        Test-Path $script:dir | Should -BeTrue
    }

    It 'returns a timestamped backend log path inside logs/' {
        $p = New-BackendLogPath -Root $script:root
        Split-Path $p -Parent | Should -Be $script:dir
        Split-Path $p -Leaf | Should -BeLike 'backend-*.log'
    }

    It 'gives a different name on a later run so runs never overwrite each other' {
        $a = New-BackendLogPath -Root $script:root -Stamp '20260904-090128'
        $b = New-BackendLogPath -Root $script:root -Stamp '20260904-091500'
        $a | Should -Not -Be $b
    }

    It 'keeps only the newest N backend logs so they cannot grow without bound' {
        New-Item -ItemType Directory $script:dir -Force | Out-Null
        foreach ($i in 1..12) {
            Set-Content (Join-Path $script:dir ('backend-2026010{0}-000000.log' -f $i)) 'x'
        }
        New-BackendLogPath -Root $script:root -Keep 5 | Out-Null
        # Chua ghi gi vao file cua luot nay, nen tren dia chi con 4 file cu +
        # cho trong cho luot hien tai = dung 5 khi backend bat dau ghi.
        (Get-ChildItem $script:dir -Filter 'backend-*.log').Count | Should -Be 4
    }

    It 'prunes the oldest and keeps the newest' {
        New-Item -ItemType Directory $script:dir -Force | Out-Null
        foreach ($i in 1..5) {
            Set-Content (Join-Path $script:dir ('backend-2026010{0}-000000.log' -f $i)) 'x'
        }
        New-BackendLogPath -Root $script:root -Keep 3 | Out-Null
        Test-Path (Join-Path $script:dir 'backend-20260105-000000.log') | Should -BeTrue
        Test-Path (Join-Path $script:dir 'backend-20260101-000000.log') | Should -BeFalse
    }

    It 'never prunes setup transcripts that share the same folder' {
        New-Item -ItemType Directory $script:dir -Force | Out-Null
        Set-Content (Join-Path $script:dir 'setup-20260819-171051.log') 'giu lai'
        foreach ($i in 1..9) {
            Set-Content (Join-Path $script:dir ('backend-2026010{0}-000000.log' -f $i)) 'x'
        }
        New-BackendLogPath -Root $script:root -Keep 2 | Out-Null
        Test-Path (Join-Path $script:dir 'setup-20260819-171051.log') | Should -BeTrue
    }
}
