# Doc bien tu .env va chay container manga-image-translator (backend).
# Dung: .\run-backend.ps1
# Ly do khong dung "docker run --env-file .env" truc tiep: cac bien rong (OPENAI_API_BASE, BACKEND_PORT)
# se bi Docker set thanh chuoi rong trong container thay vi "khong set" -> co the ghi de default cua app.
# Script nay chi truyen -e cho bien nao THAT SU co gia tri.

$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Error ".env khong ton tai. Copy tu .env.example va dien OPENAI_API_KEY truoc."
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
    Write-Error "OPENAI_API_KEY dang trong trong .env. Dien key that vao truoc khi chay."
    exit 1
}

$containerName = if ($vars.ContainsKey("CONTAINER_NAME")) { $vars["CONTAINER_NAME"] } else { "manga_translator" }

$dockerArgs = @(
    "run", "--rm",
    "--name", $containerName,
    "-p", "5003:5003",
    "-p", "8000:8000",
    "-p", "8001:8001",
    "--ipc=host",
    "--gpus", "all",
    "--entrypoint", "python",
    "-v", "$PSScriptRoot/result:/app/result",
    # KHONG mount fonts/ -> mount thu muc rong se de len font co san trong image
    # (vd Arial-Unicode-Regular.ttf can cho render VIN), gay loi "No such file or directory".
    # San pham cuoi khong dung font backend (xem spec A.1) nen khong can mount o day.
    "-e", "OPENAI_API_KEY=$($vars['OPENAI_API_KEY'])"
)

if ($vars.ContainsKey("OPENAI_MODEL")) {
    $dockerArgs += "-e"; $dockerArgs += "OPENAI_MODEL=$($vars['OPENAI_MODEL'])"
}
if ($vars.ContainsKey("OPENAI_API_BASE")) {
    $dockerArgs += "-e"; $dockerArgs += "OPENAI_API_BASE=$($vars['OPENAI_API_BASE'])"
}

$dockerArgs += @(
    # Dung image da va bug to_json.py (xem Dockerfile + patches/to_json.py).
    # Neu can rebuild: docker build -t manga-translator-patched:local .
    "manga-translator-patched:local",
    # KHONG dung --verbose: xac nhan trong source (manga_translator.py) moi
    # anh debug (input.png, bboxes.png, mask_final.png, inpaint_input.png,
    # final.png, thu muc ocrs/*.png) chi duoc ghi khi self.verbose=True (tu
    # cung dung --verbose nay). Do that: 1 lan dich (25 vung sau khi GPT
    # retry/split) ghi ra ~69MB PNG (bboxes.png/input.png/inpainted.png...
    # moi file 9-12MB) vao result/ - thu muc nay mount tu Windows qua WSL2
    # (Docker Desktop), noi tieng CHAM cho I/O nhieu file/file lon. Do
    # thuc te: khoang trong "vo hinh" 11-48 giay giua log buoc cuoi
    # ("Running rendering") va luc response THAT SU gui xong khop chinh
    # xac voi gia thuyet nay. Log tien do (Loading models/Running text
    # detection/.../GPT Prompt-Response) la logger.info() rieng, KHONG bi
    # --verbose gate - van hien day du sau khi bo co nay, chi mat phan ghi
    # anh debug (khong dung boi userscript, chi de debug backend luc dau).
    "server/main.py", "--start-instance", "--host=0.0.0.0", "--port=5003",
    "--use-gpu", "--models-ttl", "0", "--nonce", "None"
)

Write-Host "Chay: docker $($dockerArgs -replace $vars['OPENAI_API_KEY'], '***REDACTED***')"
docker @dockerArgs
