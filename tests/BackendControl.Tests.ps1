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
