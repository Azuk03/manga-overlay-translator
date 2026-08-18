BeforeAll {
    . "$PSScriptRoot/../lib/SelfTest.ps1"

    function New-Frame {
        param([byte]$Status, [string]$Payload)
        $data = [System.Text.Encoding]::UTF8.GetBytes($Payload)
        $len = [BitConverter]::GetBytes([int]$data.Length)
        if ([BitConverter]::IsLittleEndian) { [array]::Reverse($len) }
        return @($Status) + $len + $data
    }
}

Describe 'Read-StreamFrames' {
    It 'reads a single result frame' {
        $f = Read-StreamFrames -Bytes (New-Frame -Status 0 -Payload '{"a":1}')
        $f.Count | Should -Be 1
        $f[0].Status | Should -Be 0
        $f[0].Payload | Should -Be '{"a":1}'
    }
    It 'reads multiple frames in sequence' {
        $f1 = New-Frame -Status 1 -Payload 'detection'
        $f2 = New-Frame -Status 0 -Payload '{"ok":true}'
        $bytes = $f1 + $f2
        $f = Read-StreamFrames -Bytes $bytes
        $f.Count | Should -Be 2
        $f[0].Status | Should -Be 1
        $f[0].Payload | Should -Be 'detection'
        $f[1].Status | Should -Be 0
    }
    It 'reads correct big-endian length for payload over 255 bytes' {
        $long = 'x' * 300
        $f = Read-StreamFrames -Bytes (New-Frame -Status 0 -Payload $long)
        $f[0].Payload.Length | Should -Be 300
    }
    It 'returns empty array with no bytes' {
        (Read-StreamFrames -Bytes @()).Count | Should -Be 0
    }
    It 'ignores truncated frame at end instead of crashing' {
        $f1 = New-Frame -Status 0 -Payload 'ok'
        $bytes = $f1 + @([byte]1, [byte]0)
        (Read-StreamFrames -Bytes $bytes).Count | Should -Be 1
    }
}

Describe 'Get-ResultFrame' {
    It 'gets status 0 frame' {
        $frames = @(
            [pscustomobject]@{ Status = 1; Payload = 'detection' },
            [pscustomobject]@{ Status = 0; Payload = '{"ok":1}' }
        )
        (Get-ResultFrame -Frames $frames).Payload | Should -Be '{"ok":1}'
    }
    It 'returns null when backend still starting (only status 2 frame)' {
        $frames = @([pscustomobject]@{ Status = 2; Payload = 'Translation service is starting up...' })
        Get-ResultFrame -Frames $frames | Should -BeNullOrEmpty
    }
}
