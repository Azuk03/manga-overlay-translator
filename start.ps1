# start.ps1
$root = $PSScriptRoot
foreach ($m in @('Ui', 'EnvFile', 'BackendControl', 'DockerImage', 'SelfTest', 'Preflight')) { . (Join-Path $root "lib/$m.ps1") }
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

# Image co the bien mat sau 'docker system prune -a' hoac khi Docker Desktop bi
# reset, trong khi .docker-image-hash van con nen nhin vao marker thi thay "on".
# Khong chan o day thi 'docker run' se di keo image tu Docker Hub - noi khong he
# co no - roi chet voi 'pull access denied', mot thong bao chang lien quan gi.
$imageName = 'manga-translator-patched:local'
if (-not (Test-DockerImageExists -ImageName $imageName)) {
    Write-Err "Không tìm thấy image '$imageName' trên máy."
    Write-Err 'Image đã bị xoá, thường là do dọn dẹp Docker hoặc reset Docker Desktop.'
    Write-Err 'Chạy lại setup.ps1 để build lại image rồi bật lại.'
    Read-Host 'Enter để đóng'
    exit 1
}

$vars = Read-EnvFile -Path (Join-Path $root '.env')
$resultDir = Join-Path $root 'result'
New-Item -ItemType Directory $resultDir -Force | Out-Null
Stop-Backend -ContainerName 'manga_translator'
$dockerArgs = Build-DockerRunArgs -EnvVars $vars -HasGpu (Test-NvidiaGpu) -ContainerName 'manga_translator' -ResultDir $resultDir
Write-Host "  docker $((Hide-Secrets -Arguments $dockerArgs) -join ' ')"

$logPath = New-BackendLogPath -Root $root
Write-Host "  Log: $logPath"

# Tee-Object cua PS 5.1 KHONG co -Encoding (da kiem: Parameters khong chua no)
# nen no ghi bang codepage ANSI, lam nat chu Nhat trong log. StreamWriter UTF-8
# thi dung, va Flush() tung dong de log con nguyen khi container bi giet dot
# ngot - dung luc can no nhat.
$job = Start-Job -ScriptBlock {
    param($a, $log)
    # PS 5.1 giai ma output cua native exe theo codepage ANSI cua he thong -
    # do that: thanh tien trinh tqdm ra 'ΓûêΓûê', va chu Nhat trong thong bao
    # loi cung se nat y het. Ep UTF-8 TRUOC khi goi docker.
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $sw = New-Object System.IO.StreamWriter($log, $true, (New-Object System.Text.UTF8Encoding($false)))
    try {
        docker @a *>&1 | ForEach-Object {
            # '*>&1' tren native exe boc tung dong stderr thanh ErrorRecord
            # (NativeCommandError), ma [string] cua no chi ra dung chuoi
            # 'System.Management.Automation.RemoteException' - mat noi dung
            # that. Uvicorn ghi TOAN BO dong request ra stderr nen khong xu ly
            # nhanh nay la mat dung thu can doc.
            $text = if ($_ -is [System.Management.Automation.ErrorRecord]) {
                $_.Exception.Message
            } else { [string]$_ }
            # Gio dau dong: de doi chieu loi trong log voi luc dang doc trang nao.
            $sw.WriteLine((Get-Date -Format 'HH:mm:ss') + ' ' + $text)
            $sw.Flush()
            $_
        }
    } finally { $sw.Dispose() }
} -ArgumentList $dockerArgs, $logPath
Write-Warn 'ĐANG KHỞI ĐỘNG… (lần đầu trong phiên có thể mất 1-2 phút để nạp model)'
if (Wait-BackendReady -BaseUrl 'http://127.0.0.1:5003' -ImagePath (Join-Path $root 'fixtures/cjk_vertical_test.png') -TimeoutSec 600 -IsAlive { $job.State -eq 'Running' }) {
    Write-Ok 'ĐÃ SẴN SÀNG — vào trang truyện và bấm Alt+D.'
} else {
    if ($job.State -ne 'Running') {
        Write-Err 'Tiến trình docker đã thoát:'
        Receive-Job $job 2>&1 | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" }
    } else {
        Write-Err "Backend không sẵn sàng. Xem log: $logPath"
    }
}
Write-Warn 'Nhấn Ctrl+C để dừng backend.'
Write-Warn 'Nếu backend vẫn còn chạy sau đó, dừng bằng lệnh: docker stop manga_translator'
Write-Warn "Log của lần chạy này được ghi vào: $logPath"
try {
    Wait-Job $job | Out-Null
} finally {
    # Chay khi Ctrl+C hoac khi script ket thuc binh thuong. Nut X dong cua
    # so thi PowerShell khong trap duoc, nen van giu cau nhac lenh o tren.
    Stop-Backend -ContainerName 'manga_translator'
}