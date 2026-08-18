BeforeAll {
    $script:RepoRoot = Split-Path $PSScriptRoot -Parent
}

Describe 'Encoding của mã nguồn PowerShell' {
    It 'mọi file .ps1 có ký tự phi-ASCII đều phải có BOM UTF-8' {
        $offenders = @()
        $files = Get-ChildItem -Path $script:RepoRoot -Filter *.ps1 -Recurse -File |
            Where-Object { $_.FullName -notmatch '\\\.claude\\' -and $_.FullName -notmatch '\\\.superpowers\\' }
        foreach ($f in $files) {
            $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
            $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
            if ($hasBom) { continue }
            $text = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
            $nonAscii = 0
            foreach ($ch in $text.ToCharArray()) {
                if ([int]$ch -gt 127) { $nonAscii++ }
            }
            if ($nonAscii -gt 0) {
                $offenders += ($f.FullName + " (" + $nonAscii + " ký tự phi-ASCII)")
            }
        }
        # Thông báo phải liệt kê file vi phạm, nếu không người sửa sẽ phải tự đi tìm.
        $offenders -join '; ' | Should -BeNullOrEmpty
    }
}
