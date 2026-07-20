BeforeAll {
    $script:content = Get-Content (Join-Path $PSScriptRoot "manga-overlay-translator.user.js") -Raw
    $script:pattern1 = [regex]::Escape("@updateURL    https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/manga-overlay-translator.user.js")
    $script:pattern2 = [regex]::Escape("@downloadURL  https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/manga-overlay-translator.user.js")
    $script:pattern3 = [regex]::Escape("@version      0.40")
}

Describe "Userscript header metadata" {
    It "declares @updateURL pointing to the GitHub raw file" {
        $script:content | Should -Match $script:pattern1
    }

    It "declares @downloadURL pointing to the GitHub raw file" {
        $script:content | Should -Match $script:pattern2
    }

    It "bumps the version to 0.40" {
        $script:content | Should -Match $script:pattern3
    }
}
