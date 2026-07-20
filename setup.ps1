# Cai dat / cap nhat Manga Overlay Translator. An toan de chay lai nhieu lan (idempotent).
# Dung: bam dup setup.bat (goi file nay voi ExecutionPolicy Bypass).

$root = $PSScriptRoot
. (Join-Path $root "lib/SetupHelpers.ps1")
. (Join-Path $root "lib/EnvFile.ps1")
. (Join-Path $root "lib/ImageHash.ps1")
. (Join-Path $root "lib/Shortcut.ps1")
. (Join-Path $root "lib/ApiKeyDialog.ps1")

$RAW_USERSCRIPT_URL = "https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/manga-overlay-translator.user.js"
$DOCKER_DOWNLOAD_URL = "https://www.docker.com/products/docker-desktop/"

Write-Host "=== Manga Overlay Translator - Cai dat ==="

Write-Host "`n[1/6] Kiem tra Docker Desktop..."
if (-not (Test-DockerReady)) {
    Write-Host "Khong tim thay Docker dang chay. Dang mo trang tai Docker Desktop..." -ForegroundColor Yellow
    Start-Process $DOCKER_DOWNLOAD_URL
    Write-Host "Cai Docker Desktop xong, mo no len va doi no chay xong, roi bam dup lai setup.bat." -ForegroundColor Yellow
    exit 1
}
Write-Host "OK - Docker dang chay."

Write-Host "`n[2/6] Kiem tra GPU NVIDIA..."
$hasGpu = Test-NvidiaGpu
if ($hasGpu) {
    Write-Host "OK - Da phat hien GPU NVIDIA."
} else {
    Write-Host "KHONG PHAT HIEN GPU NVIDIA - se chay che do CPU (cham hon nhieu)." -ForegroundColor Yellow
}

Write-Host "`n[3/6] Kiem tra OpenAI API key..."
$envPath = Join-Path $root ".env"
$envExamplePath = Join-Path $root ".env.example"
$existingKey = Get-EnvApiKey -EnvPath $envPath
if (-not $existingKey) {
    Write-Host "Chua co API key hop le, mo hop thoai nhap lieu..."
    $newKey = Show-ApiKeyPrompt -ExistingKey ""
    if (-not $newKey) {
        Write-Host "Da huy nhap API key. Dung cai dat." -ForegroundColor Red
        exit 1
    }
    Set-EnvApiKey -EnvPath $envPath -EnvExamplePath $envExamplePath -ApiKey $newKey
    Write-Host "OK - Da luu API key vao .env."
} else {
    Write-Host "OK - Da co API key trong .env."
}

Write-Host "`n[4/6] Kiem tra Docker image..."
$dockerfilePath = Join-Path $root "Dockerfile"
$patchesDir = Join-Path $root "patches"
$hashMarkerPath = Join-Path $root ".docker-image-hash"
$currentHash = Get-DockerImageHash -DockerfilePath $dockerfilePath -PatchesDir $patchesDir
if (Test-NeedsRebuild -CurrentHash $currentHash -MarkerPath $hashMarkerPath) {
    Write-Host "Can build lai image (lan dau hoac co thay doi patches/Dockerfile)."
    Write-Host "Dang build - lan dau co the mat 10-30 phut (tai model AI)..." -ForegroundColor Yellow
    Push-Location $root
    docker build -t manga-translator-patched:local .
    $buildExitCode = $LASTEXITCODE
    Pop-Location
    if ($buildExitCode -ne 0) {
        Write-Host "Build that bai. Kiem tra mang roi chay lai setup.bat." -ForegroundColor Red
        exit 1
    }
    Set-ImageHashMarker -Hash $currentHash -MarkerPath $hashMarkerPath
    Write-Host "OK - Build xong."
} else {
    Write-Host "OK - Image da cap nhat, bo qua build."
}

Write-Host "`n[5/6] Tao shortcut Desktop..."
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Bat Manga Translator.lnk"
$runBackendPath = Join-Path $root "run-backend.ps1"
$created = New-DesktopShortcut -ShortcutPath $shortcutPath -TargetPath "powershell.exe" `
    -Arguments "-NoExit -ExecutionPolicy Bypass -File `"$runBackendPath`"" -WorkingDirectory $root
if ($created) {
    Write-Host "OK - Da tao shortcut '$shortcutPath'."
} else {
    Write-Host "OK - Shortcut da co san."
}

Write-Host "`n[6/6] Mo trang cai userscript..."
Start-Process $RAW_USERSCRIPT_URL

Write-Host "`n=== XONG! ==="
Write-Host "Bam 'Install' trong tab Tampermonkey vua mo (neu chua cai truoc do)."
Write-Host "Lan sau muon dung: bam dup shortcut 'Bat Manga Translator' ngoai Desktop, roi vao trang truyen bam Alt+D."
