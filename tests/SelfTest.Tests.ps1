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

Describe 'Wait-BackendReady' {
    BeforeEach {
        # Probe luon that bai: backend khong bao gio san sang trong cac test nay.
        Mock Invoke-TranslateProbe { return [byte[]]@() }
    }

    It 'thoat ngay khi tien trinh docker da chet, khong doi het timeout' {
        $r = Wait-BackendReady -BaseUrl 'http://127.0.0.1:5003' -ImagePath 'x.png' `
            -TimeoutSec 6 -IsAlive { $false }
        $r | Should -BeFalse
        # Neu van lap cho, timeout 6s + sleep 5s se cho it nhat 2 lan probe.
        Should -Invoke Invoke-TranslateProbe -Times 1 -Exactly
    }

    It 'van cho het timeout khi tien trinh docker con song' {
        $r = Wait-BackendReady -BaseUrl 'http://127.0.0.1:5003' -ImagePath 'x.png' `
            -TimeoutSec 6 -IsAlive { $true }
        $r | Should -BeFalse
        Should -Invoke Invoke-TranslateProbe -Times 2
    }

    It 'bao san sang khi probe tra ve frame ket qua' {
        Mock Invoke-TranslateProbe {
            $data = [System.Text.Encoding]::UTF8.GetBytes('{"ok":1}')
            $len = [BitConverter]::GetBytes([int]$data.Length)
            if ([BitConverter]::IsLittleEndian) { [array]::Reverse($len) }
            return [byte[]](@([byte]0) + $len + $data)
        }
        Wait-BackendReady -BaseUrl 'http://127.0.0.1:5003' -ImagePath 'x.png' `
            -TimeoutSec 6 -IsAlive { $true } | Should -BeTrue
    }

    It 'chay binh thuong khi khong truyen -IsAlive' {
        Wait-BackendReady -BaseUrl 'http://127.0.0.1:5003' -ImagePath 'x.png' `
            -TimeoutSec 6 | Should -BeFalse
    }
}
