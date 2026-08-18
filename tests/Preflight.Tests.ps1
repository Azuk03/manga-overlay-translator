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
    It 'throws a clear error for a path with no drive letter' {
        { Get-FreeSpaceGb -Path '\\server\share\folder' } | Should -Throw
    }
}

Describe 'Get-VramMbFromSmiOutput' {
    It 'reads total VRAM from nvidia-smi line' {
        Get-VramMbFromSmiOutput -Text '4096 MiB' | Should -Be 4096
    }
    It 'returns 0 when unable to read' {
        Get-VramMbFromSmiOutput -Text 'no data here' | Should -Be 0
    }
    It 'takes total VRAM, not used, from a real nvidia-smi line' {
        Get-VramMbFromSmiOutput -Text "|  0`%   45C    P8    12W /  80W |    512MiB /  4096MiB |" | Should -Be 4096
    }
}

Describe 'Test-NvidiaGpu' {
    It 'returns false instead of throwing when the executable is missing' {
        # Chứng minh nhánh catch: đổi PATH thành rỗng nên không tìm thấy exe nào.
        $saved = $env:PATH
        try {
            $env:PATH = ''
            { Test-NvidiaGpu } | Should -Not -Throw
        } finally {
            $env:PATH = $saved
        }
    }
}
