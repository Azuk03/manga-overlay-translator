BeforeAll {
    . "$PSScriptRoot/SetupHelpers.ps1"
}

Describe "Test-ApiKeyFormat" {
    It "returns false for empty string" {
        Test-ApiKeyFormat -Key "" | Should -BeFalse
    }
    It "returns false for whitespace only" {
        Test-ApiKeyFormat -Key "   " | Should -BeFalse
    }
    It "returns false for a key missing the sk- prefix" {
        Test-ApiKeyFormat -Key "abc123" | Should -BeFalse
    }
    It "returns true for a valid sk- prefixed key" {
        Test-ApiKeyFormat -Key "sk-abc123" | Should -BeTrue
    }
    It "trims surrounding whitespace before checking the prefix" {
        Test-ApiKeyFormat -Key "  sk-abc123  " | Should -BeTrue
    }
}

Describe "Test-DockerReady" {
    It "returns true when docker exits with code 0" {
        Mock -CommandName docker -MockWith { $global:LASTEXITCODE = 0 }
        Test-DockerReady | Should -BeTrue
    }
    It "returns false when docker exits with a non-zero code" {
        Mock -CommandName docker -MockWith { $global:LASTEXITCODE = 1 }
        Test-DockerReady | Should -BeFalse
    }
}

Describe "Test-NvidiaGpu" {
    It "returns true when nvidia-smi exits with code 0" {
        Mock -CommandName nvidia-smi -MockWith { $global:LASTEXITCODE = 0 }
        Test-NvidiaGpu | Should -BeTrue
    }
    It "returns false when nvidia-smi exits with a non-zero code" {
        Mock -CommandName nvidia-smi -MockWith { $global:LASTEXITCODE = 1 }
        Test-NvidiaGpu | Should -BeFalse
    }
}

Describe "Build-DockerRunArgs" {
    BeforeEach {
        $script:envVars = @{ OPENAI_API_KEY = "sk-test" }
    }

    It "includes --gpus all and --use-gpu when HasGpu is true" {
        $dockerArgs = Build-DockerRunArgs -EnvVars $script:envVars -HasGpu $true -ContainerName "test_container" -ResultDir "C:/result"
        $dockerArgs | Should -Contain "--gpus"
        $dockerArgs | Should -Contain "--use-gpu"
    }

    It "excludes --gpus and --use-gpu when HasGpu is false" {
        $dockerArgs = Build-DockerRunArgs -EnvVars $script:envVars -HasGpu $false -ContainerName "test_container" -ResultDir "C:/result"
        $dockerArgs | Should -Not -Contain "--gpus"
        $dockerArgs | Should -Not -Contain "--use-gpu"
    }

    It "includes OPENAI_MODEL when present in EnvVars" {
        $script:envVars["OPENAI_MODEL"] = "gpt-4o-mini"
        $dockerArgs = Build-DockerRunArgs -EnvVars $script:envVars -HasGpu $true -ContainerName "test_container" -ResultDir "C:/result"
        ($dockerArgs -join " ") | Should -Match "OPENAI_MODEL=gpt-4o-mini"
    }

    It "omits OPENAI_API_BASE when not present in EnvVars" {
        $dockerArgs = Build-DockerRunArgs -EnvVars $script:envVars -HasGpu $true -ContainerName "test_container" -ResultDir "C:/result"
        ($dockerArgs -join " ") | Should -Not -Match "OPENAI_API_BASE"
    }

    It "uses the given container name" {
        $dockerArgs = Build-DockerRunArgs -EnvVars $script:envVars -HasGpu $true -ContainerName "my_container" -ResultDir "C:/result"
        $dockerArgs | Should -Contain "my_container"
    }
}
