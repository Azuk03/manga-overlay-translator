# start.ps1
$root = $PSScriptRoot
foreach ($m in @('Ui', 'EnvFile', 'BackendControl', 'SelfTest', 'Preflight')) { . (Join-Path $root "lib/$m.ps1") }
Initialize-Ui

Write-Step 'Bật Manga Translator'
if (-not (Test-DockerDaemonReady)) {
    Write-Warn 'Docker chưa chạy, đang mở Docker Desktop...'
    Start-DockerDesktop | Out-Null
    if (-not (Wait-DockerDaemon -TimeoutSec 180)) {
        Write-Err 'Docker không lên sau 3 phút. Mở Docker Desktop để xem nó báo gì.'
        Read-Host 'Enter để đóng'
        exit 1
    }
}
Write-Ok 'Docker đang chạy.'

$vars = Read-EnvFile -Path (Join-Path $root '.env')
$resultDir = Join-Path $root 'result'
New-Item -ItemType Directory $resultDir -Force | Out-Null
Stop-Backend -ContainerName 'manga_translator'
$dockerArgs = Build-DockerRunArgs -EnvVars $vars -HasGpu (Test-NvidiaGpu) -ContainerName 'manga_translator' -ResultDir $resultDir
Write-Host "  docker $((Hide-Secrets -Arguments $dockerArgs) -join ' ')"

$job = Start-Job -ScriptBlock { param($a) docker @a } -ArgumentList (, $dockerArgs)
Write-Warn 'ĐANG KHỞI ĐỘNG… (lần đầu trong phiên có thể mất 1-2 phút để nạp model)'
if (Wait-BackendReady -BaseUrl 'http://127.0.0.1:5003' -ImagePath (Join-Path $root 'fixtures/cjk_vertical_test.png') -TimeoutSec 600) {
    Write-Ok 'ĐÃ SẴN SÀNG — vào trang truyện và bấm Alt+D.'
} else {
    Write-Err 'Backend không sẵn sàng. Xem log: docker logs manga_translator'
}
Write-Warn 'Nhấn Ctrl+C hoặc đóng cửa sổ này để dừng backend.'
Write-Warn 'Nếu backend vẫn còn chạy sau đó, dừng bằng lệnh: docker stop manga_translator'
try {
    Wait-Job $job | Out-Null
} finally {
    # Chay khi Ctrl+C hoac khi script ket thuc binh thuong. Nut X dong cua
    # so thi PowerShell khong trap duoc, nen van giu cau nhac lenh o tren.
    Stop-Backend -ContainerName 'manga_translator'
}