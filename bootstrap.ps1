# bootstrap.ps1
# Vừa là installer vừa là updater: chỉ có MỘT đường code cho cài mới, cài lại
# và cập nhật. Chạy được cả khi máy chưa có gì (không phụ thuộc lib/).
param([switch]$AsModule, [string]$InstallDir)

$ZIP_URL = 'https://github.com/Azuk03/manga-overlay-translator/archive/refs/heads/main.zip'
$ZIP_ROOT_NAME = 'manga-overlay-translator-main'

function Get-PreservedNames {
    # Những thứ THUỘC VỀ NGƯỜI DÙNG, không được ghi đè khi cập nhật.
    return @('.env', '.docker-image-hash', 'result', 'logs')
}

function Copy-ReleaseTree {
    param([string]$SourceDir, [string]$TargetDir, [string[]]$PreserveNames)
    New-Item -ItemType Directory $TargetDir -Force | Out-Null
    foreach ($item in (Get-ChildItem $SourceDir -Force)) {
        if ($PreserveNames -contains $item.Name) {
            if (Test-Path (Join-Path $TargetDir $item.Name)) { continue }
        }
        Copy-Item $item.FullName -Destination $TargetDir -Recurse -Force
    }
}

function Invoke-Bootstrap {
    param([string]$ZipUrl, [string]$InstallDir)

    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Host 'Đang tải Manga Translator...' -ForegroundColor Cyan

    $tmp = Join-Path $env:TEMP ('mot-' + [guid]::NewGuid().ToString())
    New-Item -ItemType Directory $tmp -Force | Out-Null
    $zip = Join-Path $tmp 'src.zip'

    try {
        # ProgressPreference SilentlyContinue: Invoke-WebRequest chậm gấp nhiều
        # lần khi vẽ thanh tiến trình trong PowerShell 5.1.
        $old = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
        $ProgressPreference = $old
    } catch {
        Write-Host "Không tải được mã nguồn: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'Kiểm tra kết nối mạng rồi chạy lại install.bat.' -ForegroundColor Yellow
        return 1
    }

    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $srcDir = Join-Path $tmp $ZIP_ROOT_NAME
    if (-not (Test-Path $srcDir)) {
        Write-Host 'Gói tải về không đúng cấu trúc mong đợi.' -ForegroundColor Red
        return 1
    }

    Write-Host "Đang cài vào: $InstallDir" -ForegroundColor Cyan
    Copy-ReleaseTree -SourceDir $srcDir -TargetDir $InstallDir -PreserveNames (Get-PreservedNames)
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

    & (Join-Path $InstallDir 'setup.ps1')
    return $LASTEXITCODE
}

if (-not $AsModule) {
    $target = $InstallDir
    if ([string]::IsNullOrWhiteSpace($target)) {
        $target = Join-Path $env:LOCALAPPDATA 'MangaTranslator'
    }
    exit (Invoke-Bootstrap -ZipUrl $ZIP_URL -InstallDir $target)
}
