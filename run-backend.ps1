# Doc bien tu .env va chay container manga-image-translator (backend).
# Dung: .\run-backend.ps1
# Ly do khong dung "docker run --env-file .env" truc tiep: cac bien rong (OPENAI_API_BASE, BACKEND_PORT)
# se bi Docker set thanh chuoi rong trong container thay vi "khong set" -> co the ghi de default cua app.
# Script nay chi truyen -e cho bien nao THAT SU co gia tri.

. (Join-Path $PSScriptRoot "lib/SetupHelpers.ps1")

$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Error ".env khong ton tai. Copy tu .env.example va dien OPENAI_API_KEY truoc (hoac chay setup.bat)."
    exit 1
}

$vars = @{}
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $idx = $line.IndexOf("=")
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()
        if ($val) { $vars[$key] = $val }
    }
}

if (-not $vars.ContainsKey("OPENAI_API_KEY")) {
    Write-Error "OPENAI_API_KEY dang trong trong .env. Dien key that vao truoc khi chay (hoac chay setup.bat)."
    exit 1
}

$containerName = if ($vars.ContainsKey("CONTAINER_NAME")) { $vars["CONTAINER_NAME"] } else { "manga_translator" }

$hasGpu = Test-NvidiaGpu
if (-not $hasGpu) {
    Write-Host ""
    Write-Host "=============================================================" -ForegroundColor Yellow
    Write-Host " KHONG PHAT HIEN GPU NVIDIA - dang chay CHE DO CPU" -ForegroundColor Yellow
    Write-Host " (cham hon nhieu, moi anh co the mat 1-2 phut thay vi vai giay)" -ForegroundColor Yellow
    Write-Host "=============================================================" -ForegroundColor Yellow
    Write-Host ""
}

$resultDir = Join-Path $PSScriptRoot "result"
$dockerArgs = Build-DockerRunArgs -EnvVars $vars -HasGpu $hasGpu -ContainerName $containerName -ResultDir $resultDir

Write-Host "Chay: docker $($dockerArgs -replace $vars['OPENAI_API_KEY'], '***REDACTED***')"
docker @dockerArgs
