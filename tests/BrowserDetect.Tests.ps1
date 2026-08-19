BeforeAll { . "$PSScriptRoot/../lib/BrowserDetect.ps1" }

Describe 'Get-BrowserListFromPaths' {
    It 'đặt tên thân thiện cho từng exe đã biết' {
        $r = Get-BrowserListFromPaths -PathsByExe @{
            'chrome.exe'  = 'C:\a\chrome.exe'
            'msedge.exe'  = 'C:\b\msedge.exe'
            'browser.exe' = 'C:\CocCoc\browser.exe'
        }
        ($r | Where-Object { $_.Path -eq 'C:\CocCoc\browser.exe' }).Name | Should -Be 'Cốc Cốc'
        ($r | Where-Object { $_.Path -eq 'C:\a\chrome.exe' }).Name | Should -Be 'Google Chrome'
        ($r | Where-Object { $_.Path -eq 'C:\b\msedge.exe' }).Name | Should -Be 'Microsoft Edge'
    }
    It 'bỏ qua exe không có đường dẫn' {
        (Get-BrowserListFromPaths -PathsByExe @{ 'chrome.exe' = '' }).Count | Should -Be 0
    }
    It 'trả mảng rỗng khi không có browser nào' {
        (Get-BrowserListFromPaths -PathsByExe @{}).Count | Should -Be 0
    }
    It 'xếp Chrome lên đầu vì luồng Load unpacked được kiểm chứng kỹ nhất ở đó' {
        $r = Get-BrowserListFromPaths -PathsByExe @{
            'browser.exe' = 'C:\CocCoc\browser.exe'
            'chrome.exe'  = 'C:\a\chrome.exe'
        }
        $r[0].Name | Should -Be 'Google Chrome'
    }
}