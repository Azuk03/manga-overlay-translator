function Read-StreamFrames {
    param([byte[]]$Bytes)
    $frames = @()
    $i = 0
    while ($i + 5 -le $Bytes.Length) {
        $status = $Bytes[$i]
        # Độ dài là big-endian; BitConverter của .NET là little-endian trên x86.
        $lenBytes = @($Bytes[($i + 1)..($i + 4)])
        if ([BitConverter]::IsLittleEndian) { [array]::Reverse($lenBytes) }
        $len = [BitConverter]::ToInt32($lenBytes, 0)
        if ($i + 5 + $len -gt $Bytes.Length) { break }   # frame cụt -> bỏ
        $payload = ''
        if ($len -gt 0) {
            $payload = [System.Text.Encoding]::UTF8.GetString($Bytes, $i + 5, $len)
        }
        $frames += [pscustomobject]@{ Status = $status; Payload = $payload }
        $i += 5 + $len
    }
    , $frames
}

function Get-ResultFrame {
    param([array]$Frames)
    foreach ($f in $Frames) { if ($f.Status -eq 0) { return $f } }
    return $null
}

function Invoke-TranslateProbe {
    param([string]$BaseUrl, [string]$ImagePath, [bool]$DetectOnly)
    # translator "none" chạy detect + OCR bằng model cục bộ, KHÔNG gọi GPT nên
    # không tốn tiền - dùng cho lượt thử đầu.
    $translator = 'chatgpt'
    if ($DetectOnly) { $translator = 'none' }
    $config = '{"translator":{"translator":"' + $translator + '","target_lang":"VIN"},"render":{"renderer":"none"}}'
    $tmp = Join-Path $env:TEMP ("mot-probe-" + [guid]::NewGuid().ToString() + ".bin")
    $cfgFile = Join-Path $env:TEMP ("mot-cfg-" + [guid]::NewGuid().ToString() + ".json")
    [System.IO.File]::WriteAllText($cfgFile, $config, (New-Object System.Text.UTF8Encoding($false)))
    # curl.exe có sẵn trong Windows 10+; Invoke-RestMethod -Form chỉ có từ PS 6.
    # Ghi ra file thay vì bắt stdout: PowerShell làm hỏng dữ liệu nhị phân qua pipe.
    try {
        # PS 5.1 nuot dau nhay kep khi dung dong lenh cho native exe, nen KHONG
        # duoc truyen JSON truc tiep vao -F. Doc tu file la cach duy nhat dung
        # bat ke quy tac trich dan cua PowerShell. Da do that: truyen truc tiep
        # -> "Internal Server Error"; doc tu file -> 14 frame, co status 0.
        curl.exe -s -o $tmp -F "image=@$ImagePath" -F "config=<$cfgFile" "$BaseUrl/translate/with-form/json/stream" | Out-Null
        $curlExit = $LASTEXITCODE
    } finally {
        Remove-Item $cfgFile -ErrorAction SilentlyContinue
    }
    if ($curlExit -ne 0) {
        Remove-Item $tmp -ErrorAction SilentlyContinue
        return [byte[]]@()
    }
    if (-not (Test-Path $tmp)) { return [byte[]]@() }
    $bytes = [System.IO.File]::ReadAllBytes($tmp)
    Remove-Item $tmp -ErrorAction SilentlyContinue
    return [byte[]]$bytes
}

function Wait-BackendReady {
    param([string]$BaseUrl, [string]$ImagePath, [int]$TimeoutSec = 300)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $bytes = Invoke-TranslateProbe -BaseUrl $BaseUrl -ImagePath $ImagePath -DetectOnly $true
        $result = Get-ResultFrame -Frames (Read-StreamFrames -Bytes $bytes)
        if ($null -ne $result) { return $true }
        Start-Sleep -Seconds 5
    }
    return $false
}
