BeforeAll {
    . "$PSScriptRoot/EnvFile.ps1"
}

Describe "Get-EnvApiKey" {
    It "returns null when the .env file does not exist" {
        Get-EnvApiKey -EnvPath "$TestDrive/missing.env" | Should -BeNullOrEmpty
    }

    It "returns null when OPENAI_API_KEY is present but empty" {
        Set-Content -Path "$TestDrive/empty.env" -Value @("OPENAI_API_KEY=", "OPENAI_MODEL=gpt-4o-mini")
        Get-EnvApiKey -EnvPath "$TestDrive/empty.env" | Should -BeNullOrEmpty
    }

    It "returns the key value when present" {
        Set-Content -Path "$TestDrive/filled.env" -Value @("OPENAI_API_KEY=sk-realkey", "OPENAI_MODEL=gpt-4o-mini")
        Get-EnvApiKey -EnvPath "$TestDrive/filled.env" | Should -Be "sk-realkey"
    }
}

Describe "Set-EnvApiKey" {
    BeforeEach {
        Set-Content -Path "$TestDrive/example.env.example" -Value @(
            "# comment",
            "OPENAI_API_KEY=",
            "OPENAI_MODEL=gpt-4o-mini",
            "BACKEND_PORT="
        )
    }

    It "creates .env from .env.example when .env does not exist" {
        $envPath = "$TestDrive/new.env"
        Set-EnvApiKey -EnvPath $envPath -EnvExamplePath "$TestDrive/example.env.example" -ApiKey "sk-first"
        Test-Path $envPath | Should -BeTrue
        Get-EnvApiKey -EnvPath $envPath | Should -Be "sk-first"
    }

    It "updates an existing key on the second call instead of duplicating the line" {
        $envPath = "$TestDrive/existing.env"
        Set-EnvApiKey -EnvPath $envPath -EnvExamplePath "$TestDrive/example.env.example" -ApiKey "sk-first"
        Set-EnvApiKey -EnvPath $envPath -EnvExamplePath "$TestDrive/example.env.example" -ApiKey "sk-second"
        Get-EnvApiKey -EnvPath $envPath | Should -Be "sk-second"
        $matches = Get-Content $envPath | Select-String "^OPENAI_API_KEY="
        $matches.Count | Should -Be 1
    }

    It "preserves other lines from .env.example" {
        $envPath = "$TestDrive/preserved.env"
        Set-EnvApiKey -EnvPath $envPath -EnvExamplePath "$TestDrive/example.env.example" -ApiKey "sk-first"
        (Get-Content $envPath) -join "`n" | Should -Match "OPENAI_MODEL=gpt-4o-mini"
    }
}
