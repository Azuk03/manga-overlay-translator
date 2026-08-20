# run-backend.ps1
# Lớp mỏng cho việc phát triển. Người dùng cuối dùng shortcut "Bật Manga
# Translator" (start.ps1). Mọi logic docker nằm ở lib/BackendControl.ps1 để
# không có hai bản trôi dạt khỏi nhau.
$root = $PSScriptRoot
foreach ($m in @('Ui', 'EnvFile', 'BackendControl', 'Preflight')) { . (Join-Path $root "lib/$m.ps1") }
Initialize-Ui

$envPath = Join-Path $root '.env'
if (-not (Test-Path $envPath)) {
    Write-Err '.env không tồn tại. Copy từ .env.example và điền OPENAI_API_KEY trước.'
    exit 1
}
$vars = Read-EnvFile -Path $envPath
if (-not $vars.ContainsKey('OPENAI_API_KEY')) {
    Write-Err 'OPENAI_API_KEY đang trống trong .env.'
    exit 1
}
$containerName = 'manga_translator'
if ($vars.ContainsKey('CONTAINER_NAME')) { $containerName = $vars['CONTAINER_NAME'] }
$resultDir = Join-Path $root 'result'
New-Item -ItemType Directory $resultDir -Force | Out-Null

$dockerArgs = Build-DockerRunArgs -EnvVars $vars -HasGpu (Test-NvidiaGpu) -ContainerName $containerName -ResultDir $resultDir
Write-Host "Chạy: docker $((Hide-Secrets -Arguments $dockerArgs) -join ' ')"
Start-Backend -DockerArgs $dockerArgs
