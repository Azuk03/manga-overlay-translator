function Get-GuideSteps {
    param([string]$ExtensionPath)
    return @(
        '1. Bật công tắc "Developer mode" ở góc trên bên phải trang vừa mở.',
        '2. Bấm nút "Load unpacked".',
        "3. Chọn thư mục này (đã copy sẵn vào clipboard): $ExtensionPath",
        '4. Bấm biểu tượng extension trên thanh công cụ, rồi bấm "Test kết nối". Thấy báo OK là xong.'
    )
}

function Show-ExtensionGuide {
    param([string]$Root)
    $extPath = Join-Path $Root 'extension'
    Set-Clipboard -Value $extPath
    Start-Process explorer.exe -ArgumentList $extPath

    $browsers = Get-InstalledBrowsers
    if ($browsers.Count -gt 0) {
        Open-UrlInBrowser -BrowserPath $browsers[0].Path -Url 'chrome://extensions'
    }

    Add-Type -AssemblyName System.Windows.Forms
    $text = (Get-GuideSteps -ExtensionPath $extPath) -join "`n`n"
    [System.Windows.Forms.MessageBox]::Show(
        "$text`n`nĐường dẫn đã nằm sẵn trong clipboard, chỉ cần dán vào ô chọn thư mục.",
        'Bước cuối: nạp extension vào trình duyệt', 'OK', 'Information') | Out-Null
}