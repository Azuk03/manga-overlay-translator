# setup.ps1
param([switch]$DryRun, [switch]$AsModule)

$root = $PSScriptRoot
foreach ($m in @('Ui', 'EnvFile', 'BackendControl', 'DockerImage', 'SelfTest', 'Preflight', 'BrowserDetect', 'Shortcut', 'ConfigDialog', 'ExtensionGuide')) {
    . (Join-Path $root "lib/$m.ps1")
}

function Get-SetupSteps {
    return @(
        'Kiểm tra máy',
        'Docker Desktop',
        'Kiểm tra GPU',
        'Cấu hình khoá API',
        'Build image',
        'Khởi động và tự kiểm tra',
        'Tạo shortcut',
        'Nạp extension vào trình duyệt'
    )
}

function Invoke-Setup {
    param([string]$Root, [bool]$DryRun)

    Initialize-Ui
    Start-SetupTranscript -Root $Root
    $steps = Get-SetupSteps
    $total = $steps.Count
    $envPath = Join-Path $Root '.env'
    $imageName = 'manga-translator-patched:local'
    if ($DryRun) { Write-Warn 'Chế độ thử: sẽ không build, không ghi .env, không tạo shortcut.' }

    Write-Step (Format-StepLine 1 $total $steps[0])
    $dockerData = Get-DockerDataPath
    $freeGb = Get-FreeSpaceGb -Path $dockerData
    if (-not (Test-EnoughDisk -FreeGb $freeGb -RequiredGb 20.0)) {
        Write-Err "Cần ít nhất 20 GB trống trên ổ chứa dữ liệu Docker, hiện chỉ còn $freeGb GB."
        Write-Err "Thư mục đó là: $dockerData"
        Write-Err 'Dọn bớt ổ đó, hoặc đổi chỗ lưu trong Docker Desktop > Settings > Resources > Advanced.'
        return 1
    }
    Write-Ok "Ổ chứa dữ liệu Docker còn trống $freeGb GB ($dockerData)."

    Write-Step (Format-StepLine 2 $total $steps[1])
    if (-not (Test-DockerDaemonReady)) {
        if (-not (Start-DockerDesktop)) {
            if (Test-WingetAvailable) {
                Write-Warn 'Chưa có Docker Desktop. Đang cài bằng winget...'
                if (-not $DryRun) {
                    winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements
                }
                Write-Warn 'Cài xong thường phải khởi động lại máy. Reboot rồi bấm lại install.bat.'
                return 2
            }
            Write-Err 'Không tìm thấy Docker Desktop và máy không có winget. Cài thủ công tại https://www.docker.com/products/docker-desktop/'
            return 1
        }
        Write-Warn 'Đang chờ Docker khởi động...'
        if (-not (Wait-DockerDaemon -TimeoutSec 180)) {
            Write-Err 'Docker không lên sau 3 phút. Mở cửa sổ Docker Desktop để xem nó báo lỗi gì.'
            return 1
        }
    }
    Write-Ok 'Docker đang chạy.'

    Write-Step (Format-StepLine 3 $total $steps[2])
    $hasGpu = Test-NvidiaGpu
    if ($hasGpu) {
        $vram = 0
        try {
            $smi = nvidia-smi --query-gpu=memory.total --format=csv,noheader 2>$null
            $vram = Get-VramMbFromSmiOutput -Text ($smi -join ' ')
        } catch {
            $vram = 0
        }
        if ($vram -gt 0) {
            Write-Ok "Đã phát hiện GPU NVIDIA ($vram MiB VRAM)."
        } else {
            Write-Ok 'Đã phát hiện GPU NVIDIA.'
        }
        if ($vram -gt 0 -and $vram -lt 4096) {
            Write-Warn "GPU chỉ có $vram MiB VRAM (dưới 4 GB). Dịch vẫn chạy được nhưng có thể chậm hoặc lỗi hết bộ nhớ trên ảnh lớn."
        }
    } else {
        Write-Warn 'Không thấy GPU NVIDIA. Chế độ CPU chạy được nhưng CHẬM tới mức khó dùng.'
        $answer = Read-Host 'Vẫn tiếp tục? (c/k)'
        if ($answer -ne 'c') { return 1 }
    }

    Write-Step (Format-StepLine 4 $total $steps[3])
    if ($DryRun) {
        Write-Warn 'Bỏ qua hộp thoại cấu hình (chế độ thử).'
    } else {
        Initialize-EnvFile -Path $envPath -ExamplePath (Join-Path $Root '.env.example')
        if (-not (Show-ConfigDialog -EnvPath $envPath)) {
            Write-Err 'Đã huỷ nhập cấu hình. Dừng cài đặt.'
            return 1
        }
        Write-Ok 'Đã lưu cấu hình vào .env.'
    }

    Write-Step (Format-StepLine 5 $total $steps[4])
    $hash = Get-SourceHash -DockerfilePath (Join-Path $Root 'Dockerfile') -PatchesDir (Join-Path $Root 'patches')
    $marker = Join-Path $Root '.docker-image-hash'
    $needs = Test-NeedsRebuild -CurrentHash $hash -MarkerPath $marker -ImageExists (Test-DockerImageExists -ImageName $imageName)
    if (-not $needs) {
        Write-Ok 'Image đã cập nhật, bỏ qua build.'
    } elseif ($DryRun) {
        Write-Warn 'SẼ build image (chế độ thử nên bỏ qua).'
    } else {
        Write-Warn 'Lần đầu build mất 10-30 phút và khoảng 16 GB. Đây là bình thường, đừng tắt cửa sổ.'
        if (-not (Invoke-ImageBuild -Root $Root -ImageName $imageName)) { return 1 }
        Save-ImageHashMarker -Hash $hash -MarkerPath $marker
        Write-Ok 'Build xong.'
    }

    Write-Step (Format-StepLine 6 $total $steps[5])
    if ($DryRun) {
        Write-Warn 'SẼ khởi động backend và dịch thử một ảnh (chế độ thử nên bỏ qua).'
    } else {
        $vars = Read-EnvFile -Path $envPath
        $resultDir = Join-Path $Root 'result'
        New-Item -ItemType Directory $resultDir -Force | Out-Null
        Stop-Backend -ContainerName 'manga_translator'
        # KHÔNG đặt tên biến là $args — đó là biến tự động của PowerShell.
        $dockerArgs = Build-DockerRunArgs -EnvVars $vars -HasGpu $hasGpu -ContainerName 'manga_translator' -ResultDir $resultDir
        Write-Host "  docker $((Hide-Secrets -Arguments $dockerArgs) -join ' ')"
        # Truyền MẢNG qua Start-Job, không nối chuỗi: đường dẫn result/ có thể
        # chứa dấu cách (tên tài khoản Windows), nối chuỗi sẽ tách sai tham số.
        # Dấu phẩy trước $dockerArgs để ArgumentList nhận nguyên mảng làm MỘT
        # tham số thay vì trải nó ra.
        $backendJob = Start-Job -ScriptBlock { param($a) docker @a } -ArgumentList (, $dockerArgs)
        Write-Warn 'Đang chờ backend sẵn sàng và tải model lần đầu (có thể vài phút)...'
        $probeImg = Join-Path $Root 'fixtures/cjk_vertical_test.png'
        if (-not (Wait-BackendReady -BaseUrl 'http://127.0.0.1:5003' -ImagePath $probeImg -TimeoutSec 600)) {
            Write-Err 'Backend không sẵn sàng sau 10 phút.'
            if ($backendJob.State -ne 'Running') {
                Write-Err 'Tiến trình docker đã thoát. Đầu ra cuối của nó:'
                Receive-Job $backendJob 2>&1 | Select-Object -Last 20 | ForEach-Object { Write-Host "    $_" }
            } else {
                Write-Err 'Container vẫn chạy nhưng chưa dịch được. 20 dòng log cuối:'
                try {
                    docker logs --tail 20 manga_translator 2>&1 | ForEach-Object { Write-Host "    $_" }
                } catch {
                    Write-Err '  (không gọi được docker logs)'
                }
            }
            return 1
        }
        Write-Ok 'Backend sẵn sàng (detect + OCR + GPU chạy được).'
        $bytes = Invoke-TranslateProbe -BaseUrl 'http://127.0.0.1:5003' -ImagePath $probeImg -DetectOnly $false
        $res = Get-ResultFrame -Frames (Read-StreamFrames -Bytes $bytes)
        if ($null -eq $res) {
            Write-Err 'Dịch thử thất bại. Nhiều khả năng khoá API bị từ chối. Chạy lại "Cài đặt Manga Translator" để sửa khoá.'
            return 1
        }
        $n = (ConvertFrom-Json $res.Payload).translations.Count
        Write-Ok "Dịch thử thành công, $n vùng chữ."
    }

    Write-Step (Format-StepLine 7 $total $steps[6])
    if ($DryRun) { Write-Warn 'SẼ tạo shortcut (chế độ thử nên bỏ qua).' }
    else { Install-Shortcuts -Root $Root; Write-Ok 'Đã tạo shortcut.' }

    Write-Step (Format-StepLine 8 $total $steps[7])
    if ($DryRun) { Write-Warn 'SẼ mở hướng dẫn nạp extension (chế độ thử nên bỏ qua).' }
    else { Show-ExtensionGuide -Root $Root }

    Write-Ok 'XONG. Lần sau chỉ cần bấm shortcut "Bật Manga Translator" ngoài Desktop.'
    return 0
}

if (-not $AsModule) {
    # Dừng transcript ở ĐÂY chứ không trong Invoke-Setup: hàm đó có nhiều lối
    # ra bằng `return 1` / `return 2`, đặt trong thân hàm sẽ bỏ sót các nhánh
    # lỗi — đúng những lần ta cần nhật ký nhất.
    try {
        $code = Invoke-Setup -Root $PSScriptRoot -DryRun ([bool]$DryRun)
    } catch {
        Write-Err 'Cài đặt dừng lại vì một lỗi không lường trước.'
        Write-Err ("Chi tiết: " + $_.Exception.Message)
        Write-Err 'Hãy gửi file log trong thư mục logs\ để được hỗ trợ, rồi thử chạy lại.'
        $code = 1
    }
    Stop-SetupTranscript
    exit $code
}
