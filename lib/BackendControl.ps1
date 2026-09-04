$script:SecretPattern = 'KEY|TOKEN|AUTH|SECRET'

function Build-DockerRunArgs {
    param([hashtable]$EnvVars, [bool]$HasGpu, [string]$ContainerName, [string]$ResultDir)

    # -p 127.0.0.1:5003:5003 (KHONG phai '5003:5003'): dang khong co dia chi
    # publish ra MOI interface cua may, tuc ca LAN goi duoc backend. Backend nay
    # khong co xac thuc va co /fetch-image nhan URL bat ky - dung nghia mot SSRF
    # proxy - nen chi duoc nghe tren localhost. --host=0.0.0.0 BEN TRONG container
    # thi phai giu: docker-proxy chuyen tiep vao eth0 cua container, nghe 127.0.0.1
    # trong do se khong nhan duoc goi nao.
    # 8000/8001 da bo: README muc "Port thuc te" da xac nhan thuc nghiem khong co
    # gi nghe o 2 cong do trong cau hinh nay (chung chi thuoc Web Mode/API Mode
    # chay tach rieng cua upstream).
    $a = @('run', '--rm', '--name', $ContainerName,
           '-p', '127.0.0.1:5003:5003', '--ipc=host')
    if ($HasGpu) { $a += @('--gpus', 'all') }
    # KHÔNG mount fonts/ - mount thư mục rỗng sẽ đè lên font có sẵn trong image.
    $a += @('--entrypoint', 'python', '-v', "$($ResultDir):/app/result")

    foreach ($k in @('OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_API_BASE', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'DEEPL_AUTH_KEY')) {
        if ($EnvVars.ContainsKey($k) -and $EnvVars[$k]) { $a += @('-e', "$k=$($EnvVars[$k])") }
    }

    $a += @('manga-translator-patched:local',
            'server/main.py', '--start-instance', '--host=0.0.0.0', '--port=5003')
    if ($HasGpu) { $a += '--use-gpu' }
    $a += @('--models-ttl', '0', '--nonce', 'None')
    return $a
}

function Hide-Secrets {
    param([string[]]$Arguments)
    $result = @()
    foreach ($arg in $Arguments) {
        $idx = $arg.IndexOf('=')
        if ($idx -gt 0) {
            $name = $arg.Substring(0, $idx)
            if ($name -match $script:SecretPattern) {
                $result += @("$name=***")
            } else {
                $result += @($arg)
            }
        } else {
            $result += @($arg)
        }
    }
    return @($result)
}

function Stop-Backend {
    param([string]$ContainerName)
    # docker co the da bi go khoi may (nhat la khi chay uninstall) - loi
    # phan giai lenh khong bi 2>$null chan lai, phai bat bang try/catch.
    try {
        docker stop $ContainerName 2>$null | Out-Null
    } catch { }
}

function Start-Backend {
    param([string[]]$DockerArgs)
    docker @DockerArgs
}

function New-BackendLogPath {
    # Container chay voi --rm, nen khi no dung la ca container LAN log bien mat
    # - `docker logs` khong con gi de doc. Da mat that mot lan (2026-09-04): may
    # khoi dong lai, mat sach log cua phien dich hom truoc dang can de tim loi.
    # Ghi ra file ngay tu dau la cach duy nhat giu duoc.
    param([string]$Root, [int]$Keep = 10, [string]$Stamp)

    $dir = Join-Path $Root 'logs'
    New-Item -ItemType Directory $dir -Force | Out-Null

    # Chi dung 'backend-*': setup.ps1 cung ghi transcript vao day, xoa nham la
    # mat bang chung cua lan cai dat.
    $old = @(Get-ChildItem $dir -Filter 'backend-*.log' -File -ErrorAction SilentlyContinue |
             Sort-Object Name -Descending)
    if ($old.Count -ge $Keep) {
        # Giu lai $Keep-1 file cu, cho ra dung mot cho cho luot dang chay.
        $old | Select-Object -Skip ([Math]::Max($Keep - 1, 0)) | ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }

    if (-not $Stamp) { $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss' }
    return (Join-Path $dir "backend-$Stamp.log")
}
