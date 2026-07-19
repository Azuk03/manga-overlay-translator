BeforeAll {
    . "$PSScriptRoot/ImageHash.ps1"
}

Describe "Get-DockerImageHash" {
    BeforeEach {
        New-Item -Path "$TestDrive/patches" -ItemType Directory -Force | Out-Null
        Set-Content -Path "$TestDrive/Dockerfile" -Value "FROM test:latest"
        Set-Content -Path "$TestDrive/patches/a.yaml" -Value "key: value"
    }

    It "returns the same hash for unchanged files" {
        $hash1 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        $hash2 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        $hash1 | Should -Be $hash2
    }

    It "returns a different hash when a patch file's content changes" {
        $hash1 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        Set-Content -Path "$TestDrive/patches/a.yaml" -Value "key: changed"
        $hash2 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        $hash1 | Should -Not -Be $hash2
    }

    It "returns a different hash when the Dockerfile changes" {
        $hash1 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        Set-Content -Path "$TestDrive/Dockerfile" -Value "FROM test:changed"
        $hash2 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        $hash1 | Should -Not -Be $hash2
    }
}

Describe "Test-NeedsRebuild" {
    It "returns true when the marker file does not exist" {
        Test-NeedsRebuild -CurrentHash "abc123" -MarkerPath "$TestDrive/nomarker.txt" | Should -BeTrue
    }

    It "returns false when the marker matches the current hash" {
        Set-Content -Path "$TestDrive/marker.txt" -Value "abc123" -NoNewline
        Test-NeedsRebuild -CurrentHash "abc123" -MarkerPath "$TestDrive/marker.txt" | Should -BeFalse
    }

    It "returns true when the marker differs from the current hash" {
        Set-Content -Path "$TestDrive/marker2.txt" -Value "old-hash" -NoNewline
        Test-NeedsRebuild -CurrentHash "abc123" -MarkerPath "$TestDrive/marker2.txt" | Should -BeTrue
    }
}

Describe "Set-ImageHashMarker" {
    It "writes the hash so a following Test-NeedsRebuild call returns false" {
        Set-ImageHashMarker -Hash "abc123" -MarkerPath "$TestDrive/marker3.txt"
        Test-NeedsRebuild -CurrentHash "abc123" -MarkerPath "$TestDrive/marker3.txt" | Should -BeFalse
    }
}
