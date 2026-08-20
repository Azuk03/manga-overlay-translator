BeforeAll { . "$PSScriptRoot/../setup.ps1" -AsModule }

Describe 'Get-SetupSteps' {
    It 'có đúng 8 bước, đúng thứ tự spec' {
        $s = Get-SetupSteps
        $s.Count | Should -Be 8
        $s[0] | Should -BeLike '*Kiểm tra máy*'
        $s[3] | Should -BeLike '*Cấu hình*'
        $s[4] | Should -BeLike '*Build*'
        $s[7] | Should -BeLike '*extension*'
    }
    It 'đặt bước cấu hình TRƯỚC bước build' {
        $s = Get-SetupSteps
        $cfg = [array]::FindIndex($s, [Predicate[string]] { param($x) $x -like '*Cấu hình*' })
        $bld = [array]::FindIndex($s, [Predicate[string]] { param($x) $x -like '*Build*' })
        $cfg | Should -BeLessThan $bld
    }
}
