BeforeAll { . "$PSScriptRoot/../lib/Preflight.ps1" }

Describe 'Test-EnoughDisk' {
    It 'enough when free is greater than required' { Test-EnoughDisk -FreeGb 25.0 -RequiredGb 20.0 | Should -BeTrue }
    It 'insufficient when free is less than required' { Test-EnoughDisk -FreeGb 16.1 -RequiredGb 20.0 | Should -BeFalse }
    It 'enough when exactly meets threshold' { Test-EnoughDisk -FreeGb 20.0 -RequiredGb 20.0 | Should -BeTrue }
}

Describe 'Get-FreeSpaceGb' {
    It 'returns positive number for system drive' {
        Get-FreeSpaceGb -Path $env:LOCALAPPDATA | Should -BeGreaterThan 0
    }
}

Describe 'Get-VramMbFromSmiOutput' {
    It 'reads total VRAM from nvidia-smi line' {
        Get-VramMbFromSmiOutput -Text '4096 MiB' | Should -Be 4096
    }
    It 'returns 0 when unable to read' {
        Get-VramMbFromSmiOutput -Text 'no data here' | Should -Be 0
    }
}
