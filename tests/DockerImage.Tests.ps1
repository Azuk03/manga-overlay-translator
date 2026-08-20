BeforeAll { . "$PSScriptRoot/../lib/DockerImage.ps1" }

Describe 'Get-SourceHash' {
    BeforeEach {
        $script:root = Join-Path $TestDrive ([guid]::NewGuid())
        New-Item -ItemType Directory (Join-Path $root 'patches') -Force | Out-Null
        Set-Content (Join-Path $root 'Dockerfile') 'FROM x' -Encoding UTF8
        Set-Content (Join-Path $root 'patches/a.py') 'print(1)' -Encoding UTF8
    }
    It 'cho cung hash khi noi dung khong doi' {
        $h1 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        $h2 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        $h1 | Should -Be $h2
    }
    It 'doi hash khi mot patch doi noi dung' {
        $h1 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        Set-Content (Join-Path $root 'patches/a.py') 'print(2)' -Encoding UTF8
        $h2 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        $h1 | Should -Not -Be $h2
    }
    It 'doi hash khi them patch moi' {
        $h1 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        Set-Content (Join-Path $root 'patches/b.py') 'print(3)' -Encoding UTF8
        $h2 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        $h1 | Should -Not -Be $h2
    }
}

Describe 'Test-NeedsRebuild' {
    BeforeEach {
        $script:marker = Join-Path $TestDrive ([guid]::NewGuid().ToString() + '.hash')
    }
    It 'can build khi chua co marker' {
        Test-NeedsRebuild -CurrentHash 'aaa' -MarkerPath $marker -ImageExists $true | Should -BeTrue
    }
    It 'can build khi hash khac marker' {
        Save-ImageHashMarker -Hash 'aaa' -MarkerPath $marker
        Test-NeedsRebuild -CurrentHash 'bbb' -MarkerPath $marker -ImageExists $true | Should -BeTrue
    }
    It 'KHONG can build khi hash khop va image con ton tai' {
        Save-ImageHashMarker -Hash 'aaa' -MarkerPath $marker
        Test-NeedsRebuild -CurrentHash 'aaa' -MarkerPath $marker -ImageExists $true | Should -BeFalse
    }
    It 'VAN can build khi hash khop nhung image da bi xoa tay' {
        Save-ImageHashMarker -Hash 'aaa' -MarkerPath $marker
        Test-NeedsRebuild -CurrentHash 'aaa' -MarkerPath $marker -ImageExists $false | Should -BeTrue
    }
}
