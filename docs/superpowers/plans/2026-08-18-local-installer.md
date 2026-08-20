# Local Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng tải một file `install.bat`, bấm đúp, và có sản phẩm chạy được — không thấy mã nguồn, không gõ lệnh, không tự sửa file cấu hình.

**Architecture:** Một bootstrapper tải mã nguồn về `%LOCALAPPDATA%\MangaTranslator` rồi gọi `setup.ps1` — một wizard 8 bước idempotent. Mọi logic nằm trong `lib/*.ps1` dạng hàm thuần có tham số tiêm vào, để Pester test được; các script ở gốc chỉ điều phối. Bootstrapper kiêm luôn cơ chế cập nhật, nên chỉ có một đường code cho cài mới / cài lại / cập nhật.

**Tech Stack:** Windows PowerShell 5.1, Pester 6, WinForms (System.Windows.Forms), Docker Desktop + WSL2, `curl.exe`, Python/httpx (chỉ Task 14).

**Spec:** `docs/superpowers/specs/2026-08-18-local-installer-design.md`

## Global Constraints

Mọi task đều ngầm bao gồm các ràng buộc dưới đây.

- **PowerShell 5.1** (Windows PowerShell), KHÔNG phải PS 7. Cấm dùng: toán tử `&&` / `||`, ternary `? :`, `??`, `?.`, `Invoke-RestMethod -Form`, `ConvertFrom-Json -AsHashtable`. Dùng `if/else` và `$null -eq $x`.
- **Pester phải import tường minh bản ≥ 5**: máy có sẵn cả Pester 3.4.0 (kèm Windows) lẫn 6.0.1. Lệnh chạy test luôn là:
  `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests -Output Detailed`
- **Mọi script gốc bắt đầu bằng** `. lib/Ui.ps1` rồi `Initialize-Ui` (bật UTF-8). Văn bản cho người dùng viết **tiếng Việt có dấu**.
- **MỌI file `.ps1` phải được lưu dưới dạng UTF-8 CÓ BOM.** Đây là ràng buộc bắt buộc, không phải sở thích: Windows PowerShell 5.1 đọc file nguồn phi-ASCII **không có BOM** bằng codepage ANSI, nên mọi chuỗi tiếng Việt trong file đó biến thành mojibake lúc chạy. Đã đo: cùng một file, không BOM in ra `KhÃ´ng xÃ¡c Ä‘á»‹nh...`, có BOM in ra `Không xác định được...`. Lưu ý đây là tầng KHÁC với `Initialize-Ui` — hàm đó sửa encoding của *đầu ra console*, còn BOM sửa encoding của *mã nguồn*; cần cả hai. Ghi file bằng `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($true)))`. `tests/Encoding.Tests.ps1` canh ràng buộc này cho mọi file.
- **Không yêu cầu quyền Admin** ở bất kỳ bước nào (ngoại lệ duy nhất: chính winget tự bật UAC khi cài Docker).
- Thư mục cài: `%LOCALAPPDATA%\MangaTranslator`.
- Hằng số hạ tầng: image `manga-translator-patched:local`, container `manga_translator`, port REST `5003`.
- Mẫu che secret: `KEY|TOKEN|AUTH|SECRET` (không phân biệt hoa thường).
- Repo: `https://github.com/Azuk03/manga-overlay-translator` (public), nhánh `main`.
- **TUYỆT ĐỐI không** bump `CFG.CACHE_VERSION` trong toàn bộ công việc này — bump sẽ xoá 270 MB bản dịch còn dùng tốt.
- Đường dẫn có thể chứa dấu cách. Luôn truyền tham số cho `docker` bằng **mảng**, không nối chuỗi.
- Commit message viết tiếng Anh (khớp lịch sử repo), kết thúc bằng:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `install.bat` | Wrapper ~6 dòng. Tải `bootstrap.ps1` rồi chạy. Không bao giờ phải sửa. |
| `bootstrap.ps1` | Tải ZIP, giải nén, giữ file người dùng, gọi `setup.ps1`. Kiêm updater. |
| `setup.ps1` | Wizard 8 bước, idempotent, có `-DryRun`. Chỉ điều phối. |
| `start.ps1` | Launcher "Bật Manga Translator". |
| `configure.ps1` | Mở lại hộp thoại cấu hình, ghi `.env`, tạo lại container. |
| `uninstall.ps1` | Gỡ shortcut, container, image, thư mục cài. |
| `lib/Ui.ps1` | UTF-8, `Write-Step/Ok/Warn/Err`, transcript. |
| `lib/EnvFile.ps1` | Đọc-ghi `.env` giữ nguyên comment và thứ tự dòng. |
| `lib/DockerImage.ps1` | Hash Dockerfile+patches, quyết định rebuild, gọi build. |
| `lib/BackendControl.ps1` | Dựng docker args, che secret, start/stop/recreate. |
| `lib/Preflight.ps1` | Dò Docker / GPU / đĩa / winget. |
| `lib/SelfTest.ps1` | Gọi `curl.exe`, giải mã stream framed, poll readiness. |
| `lib/BrowserDetect.ps1` | Dò browser qua registry App Paths, mở URL. |
| `lib/Shortcut.ps1` | Tạo/gỡ shortcut Desktop + Start Menu. |
| `lib/ConfigDialog.ps1` | Hộp thoại WinForms + kiểm tra khoá API. |
| `lib/ExtensionGuide.ps1` | Cửa sổ hướng dẫn nạp extension. |
| `patches/http_retry.py` | **Mới.** Hàm fetch có retry + ép IPv4, tách riêng để test được. |
| `tests/*.Tests.ps1` | Pester. |
| `INSTALL.md` | Hướng dẫn tải và cài cho người dùng cuối. |

Lý do tách `patches/http_retry.py` khỏi `patches/main.py`: `main.py` import cả FastAPI app nên không thể import trong test nếu thiếu phụ thuộc; một file nhỏ không phụ thuộc app thì test được độc lập.

---

### Task 1: `lib/Ui.ps1` — nền hiển thị và bộ khung test

**Files:**
- Create: `lib/Ui.ps1`
- Test: `tests/Ui.Tests.ps1`

**Interfaces:**
- Consumes: (không có)
- Produces: `Initialize-Ui`, `Write-Step [string]$Text`, `Write-Ok [string]$Text`, `Write-Warn [string]$Text`, `Write-Err [string]$Text`, `Format-StepLine [int]$Number [int]$Total [string]$Text` (trả `[string]`), `Get-TranscriptPath [string]$Root [datetime]$When` (trả `[string]`), `Start-SetupTranscript [string]$Root`, `Stop-SetupTranscript`

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/Ui.Tests.ps1
BeforeAll { . "$PSScriptRoot/../lib/Ui.ps1" }

Describe 'Format-StepLine' {
    It 'đánh số bước theo dạng [n/tổng]' {
        Format-StepLine -Number 3 -Total 8 -Text 'Kiểm tra GPU' | Should -Be '[3/8] Kiểm tra GPU'
    }
    It 'giữ nguyên dấu tiếng Việt' {
        Format-StepLine -Number 1 -Total 8 -Text 'Đang khởi động…' | Should -Be '[1/8] Đang khởi động…'
    }
}

Describe 'Initialize-Ui' {
    It 'đặt output encoding về UTF-8' {
        Initialize-Ui
        [Console]::OutputEncoding.WebName | Should -Be 'utf-8'
    }
}

Describe 'Get-TranscriptPath' {
    It 'đặt file dưới logs/ với dấu thời gian sắp xếp được' {
        $p = Get-TranscriptPath -Root 'C:\app' -When ([datetime]'2026-08-18T09:05:00')
        $p | Should -Be 'C:\app\logs\setup-20260818-090500.log'
    }
    It 'hai lần gọi khác thời điểm cho hai file khác nhau' {
        $a = Get-TranscriptPath -Root 'C:\app' -When ([datetime]'2026-08-18T09:05:00')
        $b = Get-TranscriptPath -Root 'C:\app' -When ([datetime]'2026-08-18T09:05:01')
        $a | Should -Not -Be $b
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/Ui.Tests.ps1 -Output Detailed`
Expected: FAIL — `The term 'Format-StepLine' is not recognized`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
# lib/Ui.ps1
function Initialize-Ui {
    # Console Windows mặc định cp1252 sẽ làm hỏng chữ có dấu. Đã đo trên máy
    # đích: chcp 65001 + OutputEncoding UTF8 cho ra chữ có dấu và cả ✓ → ⚠.
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $global:OutputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 > $null
}

function Format-StepLine {
    param([int]$Number, [int]$Total, [string]$Text)
    return "[$Number/$Total] $Text"
}

function Write-Step { param([string]$Text) Write-Host "`n$Text" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "  ✓ $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "  ⚠ $Text" -ForegroundColor Yellow }
function Write-Err  { param([string]$Text) Write-Host "  ✗ $Text" -ForegroundColor Red }

function Get-TranscriptPath {
    param([string]$Root, [datetime]$When = (Get-Date))
    return (Join-Path $Root ('logs\setup-' + $When.ToString('yyyyMMdd-HHmmss') + '.log'))
}

function Start-SetupTranscript {
    param([string]$Root)
    # Có nhật ký để đọc khi người dùng báo hỏng, thay vì hỏi vòng vo. Secret
    # không bao giờ lọt vào đây vì mọi chỗ in docker args đều đi qua
    # Hide-Secrets (xem lib/BackendControl.ps1).
    $path = Get-TranscriptPath -Root $Root
    New-Item -ItemType Directory (Split-Path $path) -Force | Out-Null
    Start-Transcript -Path $path -Force | Out-Null
}

function Stop-SetupTranscript {
    try { Stop-Transcript | Out-Null } catch { }
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/Ui.Tests.ps1 -Output Detailed`
Expected: PASS, 5 test

- [ ] **Step 5: Commit**

```bash
git add lib/Ui.ps1 tests/Ui.Tests.ps1
git commit -m "Add UTF-8 console UI helpers for the installer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `lib/EnvFile.ps1` — đọc-ghi `.env` giữ nguyên comment

**Files:**
- Create: `lib/EnvFile.ps1`
- Test: `tests/EnvFile.Tests.ps1`

**Interfaces:**
- Consumes: (không có)
- Produces: `Read-EnvFile [string]$Path` (trả `[hashtable]`), `Set-EnvValue [string]$Path [string]$Key [string]$Value`, `Initialize-EnvFile [string]$Path [string]$ExamplePath`

Bản cũ ở nhánh `worktree-feature+setup-installer` chỉ đọc-ghi được đúng `OPENAI_API_KEY`. Bản này tổng quát cho mọi khoá, và **bắt buộc giữ nguyên comment** vì `.env.example` chứa nhiều ghi chú giá trị.

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/EnvFile.Tests.ps1
BeforeAll { . "$PSScriptRoot/../lib/EnvFile.ps1" }

Describe 'Read-EnvFile' {
    It 'đọc cặp khoá-giá trị, bỏ qua comment và dòng trống' {
        $p = Join-Path $TestDrive 'a.env'
        Set-Content $p @('# ghi chú', '', 'OPENAI_API_KEY=sk-abc', 'OPENAI_MODEL=gpt-4o') -Encoding UTF8
        $v = Read-EnvFile -Path $p
        $v['OPENAI_API_KEY'] | Should -Be 'sk-abc'
        $v['OPENAI_MODEL']   | Should -Be 'gpt-4o'
        $v.Count | Should -Be 2
    }
    It 'giữ nguyên dấu = nằm trong giá trị' {
        $p = Join-Path $TestDrive 'b.env'
        Set-Content $p @('OPENAI_API_BASE=https://x.y/v1?a=b') -Encoding UTF8
        (Read-EnvFile -Path $p)['OPENAI_API_BASE'] | Should -Be 'https://x.y/v1?a=b'
    }
    It 'trả hashtable rỗng khi file không tồn tại' {
        (Read-EnvFile -Path (Join-Path $TestDrive 'khong-co.env')).Count | Should -Be 0
    }
}

Describe 'Set-EnvValue' {
    It 'thay giá trị mà KHÔNG xoá comment hay đổi thứ tự dòng' {
        $p = Join-Path $TestDrive 'c.env'
        Set-Content $p @('# đầu file', 'OPENAI_API_KEY=cu', '# giữa', 'OPENAI_MODEL=gpt-4o') -Encoding UTF8
        Set-EnvValue -Path $p -Key 'OPENAI_API_KEY' -Value 'moi'
        $lines = Get-Content $p
        $lines[0] | Should -Be '# đầu file'
        $lines[1] | Should -Be 'OPENAI_API_KEY=moi'
        $lines[2] | Should -Be '# giữa'
        $lines[3] | Should -Be 'OPENAI_MODEL=gpt-4o'
    }
    It 'thêm khoá mới vào cuối nếu chưa có' {
        $p = Join-Path $TestDrive 'd.env'
        Set-Content $p @('OPENAI_API_KEY=x') -Encoding UTF8
        Set-EnvValue -Path $p -Key 'DEEPL_AUTH_KEY' -Value 'dk'
        (Read-EnvFile -Path $p)['DEEPL_AUTH_KEY'] | Should -Be 'dk'
    }
    It 'ghi giá trị rỗng vẫn giữ dòng khoá (để làm tài liệu)' {
        $p = Join-Path $TestDrive 'e.env'
        Set-Content $p @('GEMINI_API_KEY=cu') -Encoding UTF8
        Set-EnvValue -Path $p -Key 'GEMINI_API_KEY' -Value ''
        (Get-Content $p)[0] | Should -Be 'GEMINI_API_KEY='
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/EnvFile.Tests.ps1 -Output Detailed`
Expected: FAIL — `The term 'Read-EnvFile' is not recognized`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
# lib/EnvFile.ps1
function Read-EnvFile {
    param([string]$Path)
    $result = @{}
    if (-not (Test-Path $Path)) { return $result }
    foreach ($raw in (Get-Content $Path -Encoding UTF8)) {
        $line = $raw.Trim()
        if (-not $line) { continue }
        if ($line.StartsWith('#')) { continue }
        $idx = $line.IndexOf('=')
        if ($idx -lt 1) { continue }
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()
        if ($val) { $result[$key] = $val }
    }
    return $result
}

function Set-EnvValue {
    param([string]$Path, [string]$Key, [string]$Value)
    $lines = @()
    if (Test-Path $Path) { $lines = @(Get-Content $Path -Encoding UTF8) }
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=") {
            $found = $true
            "$Key=$Value"
        } else {
            $line
        }
    }
    if (-not $found) { $out = @($out) + "$Key=$Value" }
    Set-Content -Path $Path -Value $out -Encoding UTF8
}

function Initialize-EnvFile {
    param([string]$Path, [string]$ExamplePath)
    if (-not (Test-Path $Path)) { Copy-Item $ExamplePath $Path }
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/EnvFile.Tests.ps1 -Output Detailed`
Expected: PASS, 7 test

- [ ] **Step 5: Commit**

```bash
git add lib/EnvFile.ps1 tests/EnvFile.Tests.ps1
git commit -m "Read and write .env for any key, preserving comments

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `lib/BackendControl.ps1` — docker args và che secret

**Files:**
- Create: `lib/BackendControl.ps1`
- Test: `tests/BackendControl.Tests.ps1`

**Interfaces:**
- Consumes: `Read-EnvFile` (Task 2)
- Produces: `Build-DockerRunArgs [hashtable]$EnvVars [bool]$HasGpu [string]$ContainerName [string]$ResultDir` (trả `[string[]]`), `Hide-Secrets [string[]]$Arguments` (trả `[string[]]`), `Stop-Backend [string]$ContainerName`, `Start-Backend [string[]]$DockerArgs`

Task này sửa luôn một lỗi có thật: `run-backend.ps1` dòng 84 chỉ che `OPENAI_API_KEY`, nên `GEMINI_API_KEY` và `DEEPL_AUTH_KEY` bị in nguyên văn ra console.

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/BackendControl.Tests.ps1
BeforeAll { . "$PSScriptRoot/../lib/BackendControl.ps1" }

Describe 'Build-DockerRunArgs' {
    BeforeAll {
        $script:base = @{ OPENAI_API_KEY = 'sk-abc' }
    }
    It 'thêm --gpus all khi có GPU' {
        $a = Build-DockerRunArgs -EnvVars $base -HasGpu $true -ContainerName 'c' -ResultDir 'D:\r'
        ($a -join ' ') | Should -BeLike '*--gpus all*'
    }
    It 'KHÔNG thêm --gpus khi không có GPU' {
        $a = Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r'
        ($a -join ' ') | Should -Not -BeLike '*--gpus*'
    }
    It 'chỉ truyền --use-gpu khi có GPU' {
        $g = Build-DockerRunArgs -EnvVars $base -HasGpu $true  -ContainerName 'c' -ResultDir 'D:\r'
        $c = Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r'
        $g | Should -Contain '--use-gpu'
        $c | Should -Not -Contain '--use-gpu'
    }
    It 'bỏ qua biến tuỳ chọn khi không có giá trị' {
        $a = Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r'
        ($a -join ' ') | Should -Not -BeLike '*GEMINI_API_KEY*'
    }
    It 'truyền đủ 5 biến khi .env có đủ' {
        $full = @{
            OPENAI_API_KEY = 'sk-abc'; OPENAI_MODEL = 'gpt-4o'
            OPENAI_API_BASE = 'https://x/v1'; GEMINI_API_KEY = 'gk'; DEEPL_AUTH_KEY = 'dk'
        }
        $s = (Build-DockerRunArgs -EnvVars $full -HasGpu $false -ContainerName 'c' -ResultDir 'D:\r') -join ' '
        foreach ($k in $full.Keys) { $s | Should -BeLike "*$k=*" }
    }
    It 'giữ đường dẫn có dấu cách nguyên vẹn trong một phần tử mảng' {
        $a = Build-DockerRunArgs -EnvVars $base -HasGpu $false -ContainerName 'c' -ResultDir 'C:\Program Files\r'
        $a | Should -Contain 'C:\Program Files\r:/app/result'
    }
}

Describe 'Hide-Secrets' {
    It 'che OPENAI_API_KEY' {
        (Hide-Secrets -Arguments @('-e', 'OPENAI_API_KEY=sk-abc')) | Should -Contain 'OPENAI_API_KEY=***'
    }
    It 'che CẢ GEMINI_API_KEY và DEEPL_AUTH_KEY (lỗi cũ chỉ che OpenAI)' {
        $r = Hide-Secrets -Arguments @('-e', 'GEMINI_API_KEY=gk', '-e', 'DEEPL_AUTH_KEY=dk')
        $r | Should -Contain 'GEMINI_API_KEY=***'
        $r | Should -Contain 'DEEPL_AUTH_KEY=***'
        ($r -join ' ') | Should -Not -BeLike '*gk*'
        ($r -join ' ') | Should -Not -BeLike '*dk*'
    }
    It 'KHÔNG che biến không phải secret' {
        (Hide-Secrets -Arguments @('-e', 'OPENAI_MODEL=gpt-4o')) | Should -Contain 'OPENAI_MODEL=gpt-4o'
    }
    It 'không đụng tới tham số thường' {
        (Hide-Secrets -Arguments @('run', '--rm', '--name', 'c')) -join ' ' | Should -Be 'run --rm --name c'
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/BackendControl.Tests.ps1 -Output Detailed`
Expected: FAIL — `The term 'Build-DockerRunArgs' is not recognized`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
# lib/BackendControl.ps1
$script:SecretPattern = 'KEY|TOKEN|AUTH|SECRET'

function Build-DockerRunArgs {
    param([hashtable]$EnvVars, [bool]$HasGpu, [string]$ContainerName, [string]$ResultDir)

    $a = @('run', '--rm', '--name', $ContainerName,
           '-p', '5003:5003', '-p', '8000:8000', '-p', '8001:8001', '--ipc=host')
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
    return @($Arguments | ForEach-Object {
        $idx = $_.IndexOf('=')
        if ($idx -gt 0) {
            $name = $_.Substring(0, $idx)
            if ($name -match $script:SecretPattern) { "$name=***" } else { $_ }
        } else { $_ }
    })
}

function Stop-Backend {
    param([string]$ContainerName)
    docker stop $ContainerName 2>$null | Out-Null
}

function Start-Backend {
    param([string[]]$DockerArgs)
    docker @DockerArgs
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/BackendControl.Tests.ps1 -Output Detailed`
Expected: PASS, 10 test

- [ ] **Step 5: Commit**

```bash
git add lib/BackendControl.ps1 tests/BackendControl.Tests.ps1
git commit -m "Build docker run args centrally and redact every secret

The old run-backend.ps1 redacted only OPENAI_API_KEY, so GEMINI_API_KEY
and DEEPL_AUTH_KEY were printed to the console in clear text once those
keys were added to .env. Redaction now matches KEY|TOKEN|AUTH|SECRET.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `lib/DockerImage.ps1` — quyết định rebuild

**Files:**
- Create: `lib/DockerImage.ps1`
- Test: `tests/DockerImage.Tests.ps1`

**Interfaces:**
- Consumes: `Write-Err` (Task 1)
- Produces: `Get-SourceHash [string]$DockerfilePath [string]$PatchesDir` (trả `[string]`), `Test-NeedsRebuild [string]$CurrentHash [string]$MarkerPath [bool]$ImageExists` (trả `[bool]`), `Save-ImageHashMarker [string]$Hash [string]$MarkerPath`, `Test-DockerImageExists [string]$ImageName` (trả `[bool]`), `Invoke-ImageBuild [string]$Root [string]$ImageName` (trả `[bool]`)

`Test-NeedsRebuild` nhận `ImageExists` làm **tham số** thay vì tự gọi docker, để test được. Nhánh cũ từng có lỗi chỉ so hash mà không kiểm tra image còn tồn tại — giữ nguyên cách sửa đó.

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/DockerImage.Tests.ps1
BeforeAll { . "$PSScriptRoot/../lib/DockerImage.ps1" }

Describe 'Get-SourceHash' {
    BeforeEach {
        $script:root = Join-Path $TestDrive ([guid]::NewGuid())
        New-Item -ItemType Directory (Join-Path $root 'patches') -Force | Out-Null
        Set-Content (Join-Path $root 'Dockerfile') 'FROM x' -Encoding UTF8
        Set-Content (Join-Path $root 'patches/a.py') 'print(1)' -Encoding UTF8
    }
    It 'cho cùng hash khi nội dung không đổi' {
        $h1 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        $h2 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        $h1 | Should -Be $h2
    }
    It 'đổi hash khi một patch đổi nội dung' {
        $h1 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        Set-Content (Join-Path $root 'patches/a.py') 'print(2)' -Encoding UTF8
        $h2 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        $h1 | Should -Not -Be $h2
    }
    It 'đổi hash khi thêm patch mới' {
        $h1 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        Set-Content (Join-Path $root 'patches/b.py') 'print(3)' -Encoding UTF8
        $h2 = Get-SourceHash -DockerfilePath (Join-Path $root 'Dockerfile') -PatchesDir (Join-Path $root 'patches')
        $h1 | Should -Not -Be $h2
    }
}

Describe 'Test-NeedsRebuild' {
    BeforeEach {
        $script:marker = Join-Path $TestDrive ([guid]::NewGuid().ToString() + '.hash')
    }
    It 'cần build khi chưa có marker' {
        Test-NeedsRebuild -CurrentHash 'aaa' -MarkerPath $marker -ImageExists $true | Should -BeTrue
    }
    It 'cần build khi hash khác marker' {
        Save-ImageHashMarker -Hash 'aaa' -MarkerPath $marker
        Test-NeedsRebuild -CurrentHash 'bbb' -MarkerPath $marker -ImageExists $true | Should -BeTrue
    }
    It 'KHÔNG cần build khi hash khớp và image còn tồn tại' {
        Save-ImageHashMarker -Hash 'aaa' -MarkerPath $marker
        Test-NeedsRebuild -CurrentHash 'aaa' -MarkerPath $marker -ImageExists $true | Should -BeFalse
    }
    It 'VẪN cần build khi hash khớp nhưng image đã bị xoá tay' {
        Save-ImageHashMarker -Hash 'aaa' -MarkerPath $marker
        Test-NeedsRebuild -CurrentHash 'aaa' -MarkerPath $marker -ImageExists $false | Should -BeTrue
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/DockerImage.Tests.ps1 -Output Detailed`
Expected: FAIL — `The term 'Get-SourceHash' is not recognized`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
# lib/DockerImage.ps1
function Get-SourceHash {
    param([string]$DockerfilePath, [string]$PatchesDir)
    $parts = @((Get-FileHash $DockerfilePath -Algorithm SHA256).Hash)
    # Sắp xếp theo tên để hash ổn định giữa các máy.
    foreach ($f in (Get-ChildItem $PatchesDir -File | Sort-Object Name)) {
        $parts += $f.Name
        $parts += (Get-FileHash $f.FullName -Algorithm SHA256).Hash
    }
    $joined = [System.Text.Encoding]::UTF8.GetBytes(($parts -join '|'))
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha.ComputeHash($joined))).Replace('-', '')
}

function Save-ImageHashMarker {
    param([string]$Hash, [string]$MarkerPath)
    Set-Content -Path $MarkerPath -Value $Hash -Encoding UTF8
}

function Test-NeedsRebuild {
    param([string]$CurrentHash, [string]$MarkerPath, [bool]$ImageExists)
    # Chỉ so hash là chưa đủ: image có thể đã bị xoá tay trong khi marker vẫn còn.
    if (-not $ImageExists) { return $true }
    if (-not (Test-Path $MarkerPath)) { return $true }
    return ((Get-Content $MarkerPath -Raw).Trim() -ne $CurrentHash)
}

function Test-DockerImageExists {
    param([string]$ImageName)
    docker image inspect $ImageName 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Invoke-ImageBuild {
    param([string]$Root, [string]$ImageName)
    $log = Join-Path $Root 'logs/docker-build.log'
    New-Item -ItemType Directory (Split-Path $log) -Force | Out-Null
    Push-Location $Root
    docker build -t $ImageName . 2>&1 | Tee-Object -FilePath $log
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) {
        Write-Err 'Build image thất bại. 20 dòng cuối của log:'
        Get-Content $log -Tail 20 | ForEach-Object { Write-Host "    $_" }
        return $false
    }
    return $true
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/DockerImage.Tests.ps1 -Output Detailed`
Expected: PASS, 7 test

- [ ] **Step 5: Commit**

```bash
git add lib/DockerImage.ps1 tests/DockerImage.Tests.ps1
git commit -m "Decide image rebuilds from source hash plus image presence

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `lib/SelfTest.ps1` — giải mã stream và chờ backend sẵn sàng

**Files:**
- Create: `lib/SelfTest.ps1`
- Test: `tests/SelfTest.Tests.ps1`

**Interfaces:**
- Consumes: `Write-Ok`, `Write-Warn` (Task 1)
- Produces: `Read-StreamFrames [byte[]]$Bytes` (trả mảng `[pscustomobject]@{Status;Payload}`), `Get-ResultFrame [array]$Frames` (trả `[pscustomobject]` hoặc `$null`), `Invoke-TranslateProbe [string]$BaseUrl [string]$ImagePath [bool]$DetectOnly` (trả `[byte[]]`), `Wait-BackendReady [string]$BaseUrl [string]$ImagePath [int]$TimeoutSec` (trả `[bool]`)

Giao thức đã ghi trong `README.md`: mỗi frame là `[1 byte status][4 byte length big-endian][N byte payload]`; status 0 = kết quả cuối (JSON UTF-8), 1 = tiến độ, 2 = lỗi, 3 = vị trí hàng đợi, 4 = chờ instance. Dừng đọc khi gặp 0 hoặc 2.

Đây cũng là phép thử readiness: cổng 5003 trả 200 **trước khi** executor ở 5004 sẵn sàng, nên phải thử lại chính lệnh dịch chứ không ping `/`.

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/SelfTest.Tests.ps1
BeforeAll {
    . "$PSScriptRoot/../lib/SelfTest.ps1"

    function New-Frame {
        param([byte]$Status, [string]$Payload)
        $data = [System.Text.Encoding]::UTF8.GetBytes($Payload)
        $len = [BitConverter]::GetBytes([int]$data.Length)
        if ([BitConverter]::IsLittleEndian) { [array]::Reverse($len) }
        return @($Status) + $len + $data
    }
}

Describe 'Read-StreamFrames' {
    It 'đọc được một frame kết quả' {
        $f = Read-StreamFrames -Bytes (New-Frame -Status 0 -Payload '{"a":1}')
        $f.Count | Should -Be 1
        $f[0].Status | Should -Be 0
        $f[0].Payload | Should -Be '{"a":1}'
    }
    It 'đọc nhiều frame nối tiếp đúng thứ tự' {
        $bytes = (New-Frame -Status 1 -Payload 'detection') + (New-Frame -Status 0 -Payload '{"ok":true}')
        $f = Read-StreamFrames -Bytes $bytes
        $f.Count | Should -Be 2
        $f[0].Status | Should -Be 1
        $f[0].Payload | Should -Be 'detection'
        $f[1].Status | Should -Be 0
    }
    It 'đọc đúng độ dài big-endian với payload dài hơn 255 byte' {
        $long = 'x' * 300
        $f = Read-StreamFrames -Bytes (New-Frame -Status 0 -Payload $long)
        $f[0].Payload.Length | Should -Be 300
    }
    It 'trả mảng rỗng khi không có byte nào' {
        (Read-StreamFrames -Bytes @()).Count | Should -Be 0
    }
    It 'bỏ qua frame cụt ở cuối thay vì nổ' {
        $bytes = (New-Frame -Status 0 -Payload 'ok') + @([byte]1, [byte]0)
        (Read-StreamFrames -Bytes $bytes).Count | Should -Be 1
    }
}

Describe 'Get-ResultFrame' {
    It 'lấy frame status 0' {
        $frames = @(
            [pscustomobject]@{ Status = 1; Payload = 'detection' },
            [pscustomobject]@{ Status = 0; Payload = '{"ok":1}' }
        )
        (Get-ResultFrame -Frames $frames).Payload | Should -Be '{"ok":1}'
    }
    It 'trả null khi backend còn đang khởi động (chỉ có frame status 2)' {
        $frames = @([pscustomobject]@{ Status = 2; Payload = 'Translation service is starting up...' })
        Get-ResultFrame -Frames $frames | Should -BeNullOrEmpty
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/SelfTest.Tests.ps1 -Output Detailed`
Expected: FAIL — `The term 'Read-StreamFrames' is not recognized`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
# lib/SelfTest.ps1
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
    return $frames
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
    # curl.exe có sẵn trong Windows 10+; Invoke-RestMethod -Form chỉ có từ PS 6.
    # Ghi ra file thay vì bắt stdout: PowerShell làm hỏng dữ liệu nhị phân qua pipe.
    curl.exe -s -o $tmp -F "image=@$ImagePath" -F "config=$config" "$BaseUrl/translate/with-form/json/stream" | Out-Null
    if (-not (Test-Path $tmp)) { return @() }
    $bytes = [System.IO.File]::ReadAllBytes($tmp)
    Remove-Item $tmp -ErrorAction SilentlyContinue
    return $bytes
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
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/SelfTest.Tests.ps1 -Output Detailed`
Expected: PASS, 7 test

- [ ] **Step 5: Commit**

```bash
git add lib/SelfTest.ps1 tests/SelfTest.Tests.ps1
git commit -m "Decode the backend frame stream and poll real readiness

Port 5003 answers a few seconds before the executor on 5004 is up, so
readiness is established by retrying an actual translate and waiting for
a status-0 frame, not by pinging /.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `lib/Preflight.ps1` — dò Docker, GPU, đĩa, winget

**Files:**
- Create: `lib/Preflight.ps1`
- Test: `tests/Preflight.Tests.ps1`

**Interfaces:**
- Consumes: `Write-Ok`, `Write-Warn` (Task 1)
- Produces: `Get-FreeSpaceGb [string]$Path` (trả `[double]`), `Test-EnoughDisk [double]$FreeGb [double]$RequiredGb` (trả `[bool]`), `Get-VramMbFromSmiOutput [string]$Text` (trả `[int]`), `Test-DockerDaemonReady` (trả `[bool]`), `Test-NvidiaGpu` (trả `[bool]`), `Test-WingetAvailable` (trả `[bool]`), `Start-DockerDesktop`, `Wait-DockerDaemon [int]$TimeoutSec` (trả `[bool]`)

Dung lượng phải kiểm trên ổ chứa **vhdx của WSL2** (mặc định dưới `%LOCALAPPDATA%\Docker`), không phải ổ chứa thư mục cài. Đo được: image 16.4 GB, nên ngưỡng 20 GB.

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/Preflight.Tests.ps1
BeforeAll { . "$PSScriptRoot/../lib/Preflight.ps1" }

Describe 'Test-EnoughDisk' {
    It 'đủ khi trống hơn yêu cầu' { Test-EnoughDisk -FreeGb 25.0 -RequiredGb 20.0 | Should -BeTrue }
    It 'thiếu khi trống ít hơn yêu cầu' { Test-EnoughDisk -FreeGb 16.1 -RequiredGb 20.0 | Should -BeFalse }
    It 'đủ khi bằng đúng ngưỡng' { Test-EnoughDisk -FreeGb 20.0 -RequiredGb 20.0 | Should -BeTrue }
}

Describe 'Get-FreeSpaceGb' {
    It 'trả về số dương cho ổ hệ thống' {
        Get-FreeSpaceGb -Path $env:LOCALAPPDATA | Should -BeGreaterThan 0
    }
}

Describe 'Get-VramMbFromSmiOutput' {
    It 'đọc được tổng VRAM từ dòng nvidia-smi' {
        Get-VramMbFromSmiOutput -Text '4096 MiB' | Should -Be 4096
    }
    It 'trả 0 khi không đọc được' {
        Get-VramMbFromSmiOutput -Text 'khong co gi' | Should -Be 0
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/Preflight.Tests.ps1 -Output Detailed`
Expected: FAIL — `The term 'Test-EnoughDisk' is not recognized`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
# lib/Preflight.ps1
function Get-FreeSpaceGb {
    param([string]$Path)
    $drive = (Split-Path -Qualifier $Path).TrimEnd(':')
    $d = Get-PSDrive -Name $drive
    return [math]::Round($d.Free / 1GB, 1)
}

function Test-EnoughDisk {
    param([double]$FreeGb, [double]$RequiredGb)
    return ($FreeGb -ge $RequiredGb)
}

function Get-VramMbFromSmiOutput {
    param([string]$Text)
    if ($Text -match '(\d+)\s*MiB') { return [int]$Matches[1] }
    return 0
}

function Test-DockerDaemonReady {
    docker version 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-NvidiaGpu {
    nvidia-smi 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-WingetAvailable {
    return ($null -ne (Get-Command winget -ErrorAction SilentlyContinue))
}

function Start-DockerDesktop {
    foreach ($p in @("$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
                     "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe")) {
        if (Test-Path $p) { Start-Process $p; return $true }
    }
    return $false
}

function Wait-DockerDaemon {
    param([int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-DockerDaemonReady) { return $true }
        Start-Sleep -Seconds 5
    }
    return $false
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/Preflight.Tests.ps1 -Output Detailed`
Expected: PASS, 6 test

- [ ] **Step 5: Commit**

```bash
git add lib/Preflight.ps1 tests/Preflight.Tests.ps1
git commit -m "Detect Docker, GPU, disk space and winget before installing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `lib/BrowserDetect.ps1` — dò browser và mở URL

**Files:**
- Create: `lib/BrowserDetect.ps1`
- Test: `tests/BrowserDetect.Tests.ps1`

**Interfaces:**
- Consumes: (không có)
- Produces: `Get-BrowserListFromPaths [hashtable]$PathsByExe` (trả mảng `[pscustomobject]@{Name;Path}`), `Get-InstalledBrowsers` (trả mảng như trên), `Open-UrlInBrowser [string]$BrowserPath [string]$Url`

Đã đo trên máy đích: dò được Chrome, Edge và **Cốc Cốc** (`browser.exe` dưới `CocCoc\Browser\Application`). `chrome://extensions` **không** mở được bằng `Start-Process` với browser mặc định — bắt buộc gọi thẳng file .exe kèm URL làm tham số.

Việc tra registry được tách khỏi việc dựng danh sách để test được phần thuần.

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/BrowserDetect.Tests.ps1
BeforeAll { . "$PSScriptRoot/../lib/BrowserDetect.ps1" }

Describe 'Get-BrowserListFromPaths' {
    It 'đặt tên thân thiện cho từng exe đã biết' {
        $r = Get-BrowserListFromPaths -PathsByExe @{
            'chrome.exe'  = 'C:\a\chrome.exe'
            'msedge.exe'  = 'C:\b\msedge.exe'
            'browser.exe' = 'C:\CocCoc\browser.exe'
        }
        ($r | Where-Object { $_.Path -eq 'C:\CocCoc\browser.exe' }).Name | Should -Be 'Cốc Cốc'
        ($r | Where-Object { $_.Path -eq 'C:\a\chrome.exe' }).Name | Should -Be 'Google Chrome'
        ($r | Where-Object { $_.Path -eq 'C:\b\msedge.exe' }).Name | Should -Be 'Microsoft Edge'
    }
    It 'bỏ qua exe không có đường dẫn' {
        (Get-BrowserListFromPaths -PathsByExe @{ 'chrome.exe' = '' }).Count | Should -Be 0
    }
    It 'trả mảng rỗng khi không có browser nào' {
        (Get-BrowserListFromPaths -PathsByExe @{}).Count | Should -Be 0
    }
    It 'xếp Chrome lên đầu vì luồng Load unpacked được kiểm chứng kỹ nhất ở đó' {
        $r = Get-BrowserListFromPaths -PathsByExe @{
            'browser.exe' = 'C:\CocCoc\browser.exe'
            'chrome.exe'  = 'C:\a\chrome.exe'
        }
        $r[0].Name | Should -Be 'Google Chrome'
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/BrowserDetect.Tests.ps1 -Output Detailed`
Expected: FAIL — `The term 'Get-BrowserListFromPaths' is not recognized`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
# lib/BrowserDetect.ps1
$script:KnownBrowsers = @(
    @{ Exe = 'chrome.exe';  Name = 'Google Chrome' },
    @{ Exe = 'msedge.exe';  Name = 'Microsoft Edge' },
    @{ Exe = 'browser.exe'; Name = 'Cốc Cốc' },
    @{ Exe = 'brave.exe';   Name = 'Brave' },
    @{ Exe = 'vivaldi.exe'; Name = 'Vivaldi' }
)

function Get-BrowserListFromPaths {
    param([hashtable]$PathsByExe)
    $out = @()
    # Duyệt theo thứ tự KnownBrowsers để Chrome luôn đứng đầu.
    foreach ($b in $script:KnownBrowsers) {
        if ($PathsByExe.ContainsKey($b.Exe) -and $PathsByExe[$b.Exe]) {
            $out += [pscustomobject]@{ Name = $b.Name; Path = $PathsByExe[$b.Exe] }
        }
    }
    return $out
}

function Get-InstalledBrowsers {
    $paths = @{}
    foreach ($b in $script:KnownBrowsers) {
        foreach ($hive in @('HKLM:', 'HKCU:')) {
            $key = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$($b.Exe)"
            if (Test-Path $key) {
                $v = (Get-ItemProperty $key).'(default)'
                if ($v -and -not $paths.ContainsKey($b.Exe)) { $paths[$b.Exe] = $v }
            }
        }
    }
    return Get-BrowserListFromPaths -PathsByExe $paths
}

function Open-UrlInBrowser {
    param([string]$BrowserPath, [string]$Url)
    # Phải gọi thẳng exe: Start-Process 'chrome://extensions' với browser mặc
    # định KHÔNG mở được scheme chrome://.
    Start-Process -FilePath $BrowserPath -ArgumentList $Url
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/BrowserDetect.Tests.ps1 -Output Detailed`
Expected: PASS, 4 test

- [ ] **Step 5: Commit**

```bash
git add lib/BrowserDetect.ps1 tests/BrowserDetect.Tests.ps1
git commit -m "Detect installed Chromium browsers including Coc Coc

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `lib/Shortcut.ps1` — shortcut Desktop và Start Menu

**Files:**
- Create: `lib/Shortcut.ps1`
- Test: `tests/Shortcut.Tests.ps1`

**Interfaces:**
- Consumes: (không có)
- Produces: `Get-ShortcutPlan [string]$Root` (trả mảng `[pscustomobject]@{Name;Script;OnDesktop}`), `New-AppShortcut [string]$ShortcutPath [string]$ScriptPath [string]$WorkingDirectory` (trả `[bool]`, `$false` nếu đã có), `Install-Shortcuts [string]$Root`, `Remove-AppShortcuts`

Theo spec mục 5.2: Desktop chỉ nhận **một** shortcut ("Bật Manga Translator"); Start Menu chứa đủ bốn mục, kể cả "Gỡ cài đặt".

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/Shortcut.Tests.ps1
BeforeAll { . "$PSScriptRoot/../lib/Shortcut.ps1" }

Describe 'Get-ShortcutPlan' {
    BeforeAll { $script:plan = Get-ShortcutPlan -Root 'C:\app' }
    It 'có đủ bốn mục' { $plan.Count | Should -Be 4 }
    It 'chỉ đúng MỘT mục nằm trên Desktop' {
        ($plan | Where-Object { $_.OnDesktop }).Count | Should -Be 1
    }
    It 'mục trên Desktop là "Bật Manga Translator"' {
        ($plan | Where-Object { $_.OnDesktop }).Name | Should -Be 'Bật Manga Translator'
    }
    It 'có mục gỡ cài đặt (chỉ trong Start Menu)' {
        $u = $plan | Where-Object { $_.Name -eq 'Gỡ cài đặt Manga Translator' }
        $u | Should -Not -BeNullOrEmpty
        $u.OnDesktop | Should -BeFalse
    }
    It 'trỏ tới đúng script dưới thư mục gốc' {
        ($plan | Where-Object { $_.Name -eq 'Bật Manga Translator' }).Script | Should -Be 'C:\app\start.ps1'
    }
}

Describe 'New-AppShortcut' {
    It 'tạo file .lnk và trả về true' {
        $lnk = Join-Path $TestDrive 'a.lnk'
        New-AppShortcut -ShortcutPath $lnk -ScriptPath 'C:\app\start.ps1' -WorkingDirectory 'C:\app' | Should -BeTrue
        Test-Path $lnk | Should -BeTrue
    }
    It 'idempotent: gọi lần hai trả về false và không tạo trùng' {
        $lnk = Join-Path $TestDrive 'b.lnk'
        New-AppShortcut -ShortcutPath $lnk -ScriptPath 'C:\app\start.ps1' -WorkingDirectory 'C:\app' | Out-Null
        New-AppShortcut -ShortcutPath $lnk -ScriptPath 'C:\app\start.ps1' -WorkingDirectory 'C:\app' | Should -BeFalse
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/Shortcut.Tests.ps1 -Output Detailed`
Expected: FAIL — `The term 'Get-ShortcutPlan' is not recognized`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
# lib/Shortcut.ps1
$script:StartMenuFolderName = 'Manga Translator'

function Get-ShortcutPlan {
    param([string]$Root)
    return @(
        [pscustomobject]@{ Name = 'Bật Manga Translator';      Script = (Join-Path $Root 'start.ps1');     OnDesktop = $true  },
        [pscustomobject]@{ Name = 'Cài đặt Manga Translator';  Script = (Join-Path $Root 'configure.ps1'); OnDesktop = $false },
        [pscustomobject]@{ Name = 'Cập nhật Manga Translator'; Script = (Join-Path $Root 'bootstrap.ps1'); OnDesktop = $false },
        [pscustomobject]@{ Name = 'Gỡ cài đặt Manga Translator'; Script = (Join-Path $Root 'uninstall.ps1'); OnDesktop = $false }
    )
}

function New-AppShortcut {
    param([string]$ShortcutPath, [string]$ScriptPath, [string]$WorkingDirectory)
    if (Test-Path $ShortcutPath) { return $false }
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($ShortcutPath)
    $sc.TargetPath = 'powershell.exe'
    $sc.Arguments = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
    $sc.WorkingDirectory = $WorkingDirectory
    $sc.Save()
    return $true
}

function Install-Shortcuts {
    param([string]$Root)
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) $script:StartMenuFolderName
    New-Item -ItemType Directory $startMenu -Force | Out-Null
    foreach ($item in (Get-ShortcutPlan -Root $Root)) {
        New-AppShortcut -ShortcutPath (Join-Path $startMenu "$($item.Name).lnk") -ScriptPath $item.Script -WorkingDirectory $Root | Out-Null
        if ($item.OnDesktop) {
            New-AppShortcut -ShortcutPath (Join-Path $desktop "$($item.Name).lnk") -ScriptPath $item.Script -WorkingDirectory $Root | Out-Null
        }
    }
}

function Remove-AppShortcuts {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) $script:StartMenuFolderName
    Remove-Item (Join-Path $desktop 'Bật Manga Translator.lnk') -ErrorAction SilentlyContinue
    Remove-Item $startMenu -Recurse -Force -ErrorAction SilentlyContinue
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/Shortcut.Tests.ps1 -Output Detailed`
Expected: PASS, 7 test

- [ ] **Step 5: Commit**

```bash
git add lib/Shortcut.ps1 tests/Shortcut.Tests.ps1
git commit -m "Create one desktop shortcut and a full Start Menu folder

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `lib/ConfigDialog.ps1` — hộp thoại cấu hình

**Files:**
- Create: `lib/ConfigDialog.ps1`
- Test: `tests/ConfigDialog.Tests.ps1`

**Interfaces:**
- Consumes: `Read-EnvFile`, `Set-EnvValue` (Task 2)
- Produces: `Test-KeyFormat [string]$Key` (trả `[bool]`), `Get-KeyCheckVerdict [int]$StatusCode [bool]$NetworkFailed` (trả `[string]`: `'ok'` | `'invalid'` | `'network'` | `'unknown'`), `Test-OpenAiKey [string]$Key [string]$BaseUrl [scriptblock]$Invoker` (trả `[string]` verdict), `Show-ConfigDialog [string]$EnvPath` (trả `[bool]`), `Save-ConfigToEnv [string]$EnvPath [hashtable]$Values`

`Invoker` là scriptblock tiêm vào (trả `[int]` status code) để test phân loại kết quả mà không gọi mạng thật.

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/ConfigDialog.Tests.ps1
BeforeAll {
    . "$PSScriptRoot/../lib/EnvFile.ps1"
    . "$PSScriptRoot/../lib/ConfigDialog.ps1"
}

Describe 'Test-KeyFormat' {
    It 'nhận khoá bắt đầu bằng sk-' { Test-KeyFormat -Key 'sk-abc123' | Should -BeTrue }
    It 'từ chối khoá rỗng' { Test-KeyFormat -Key '' | Should -BeFalse }
    It 'từ chối khoá sai tiền tố' { Test-KeyFormat -Key 'abc123' | Should -BeFalse }
    It 'bỏ qua khoảng trắng thừa hai đầu' { Test-KeyFormat -Key '  sk-abc  ' | Should -BeTrue }
}

Describe 'Get-KeyCheckVerdict' {
    It '200 là khoá dùng được' { Get-KeyCheckVerdict -StatusCode 200 -NetworkFailed $false | Should -Be 'ok' }
    It '401 là khoá sai' { Get-KeyCheckVerdict -StatusCode 401 -NetworkFailed $false | Should -Be 'invalid' }
    It 'lỗi mạng phân biệt hẳn với khoá sai' { Get-KeyCheckVerdict -StatusCode 0 -NetworkFailed $true | Should -Be 'network' }
    It 'mã lạ trả unknown chứ không đoán bừa' { Get-KeyCheckVerdict -StatusCode 500 -NetworkFailed $false | Should -Be 'unknown' }
}

Describe 'Test-OpenAiKey' {
    It 'dùng Invoker được tiêm vào, không gọi mạng thật' {
        $r = Test-OpenAiKey -Key 'sk-x' -BaseUrl 'https://api.openai.com/v1' -Invoker { param($k, $u) return 200 }
        $r | Should -Be 'ok'
    }
    It 'báo invalid khi Invoker trả 401' {
        Test-OpenAiKey -Key 'sk-x' -BaseUrl 'https://api.openai.com/v1' -Invoker { param($k, $u) return 401 } | Should -Be 'invalid'
    }
    It 'báo network khi Invoker ném lỗi' {
        Test-OpenAiKey -Key 'sk-x' -BaseUrl 'https://api.openai.com/v1' -Invoker { param($k, $u) throw 'khong ket noi duoc' } | Should -Be 'network'
    }
}

Describe 'Save-ConfigToEnv' {
    It 'ghi mọi khoá và giữ nguyên comment sẵn có' {
        $p = Join-Path $TestDrive 'f.env'
        Set-Content $p @('# ghi chú quan trọng', 'OPENAI_API_KEY=') -Encoding UTF8
        Save-ConfigToEnv -EnvPath $p -Values @{ OPENAI_API_KEY = 'sk-new'; OPENAI_MODEL = 'gpt-4o' }
        (Get-Content $p)[0] | Should -Be '# ghi chú quan trọng'
        (Read-EnvFile -Path $p)['OPENAI_API_KEY'] | Should -Be 'sk-new'
        (Read-EnvFile -Path $p)['OPENAI_MODEL'] | Should -Be 'gpt-4o'
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/ConfigDialog.Tests.ps1 -Output Detailed`
Expected: FAIL — `The term 'Test-KeyFormat' is not recognized`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
# lib/ConfigDialog.ps1
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Test-KeyFormat {
    param([string]$Key)
    if ([string]::IsNullOrWhiteSpace($Key)) { return $false }
    return $Key.Trim().StartsWith('sk-')
}

function Get-KeyCheckVerdict {
    param([int]$StatusCode, [bool]$NetworkFailed)
    if ($NetworkFailed) { return 'network' }
    if ($StatusCode -eq 200) { return 'ok' }
    if ($StatusCode -eq 401) { return 'invalid' }
    return 'unknown'
}

function Test-OpenAiKey {
    param([string]$Key, [string]$BaseUrl, [scriptblock]$Invoker)
    try {
        $code = & $Invoker $Key $BaseUrl
    } catch {
        return Get-KeyCheckVerdict -StatusCode 0 -NetworkFailed $true
    }
    return Get-KeyCheckVerdict -StatusCode ([int]$code) -NetworkFailed $false
}

function Invoke-OpenAiModelsCall {
    param([string]$Key, [string]$BaseUrl)
    $url = "$BaseUrl/models"
    $r = Invoke-WebRequest -Uri $url -Headers @{ Authorization = "Bearer $Key" } -UseBasicParsing -TimeoutSec 20
    return [int]$r.StatusCode
}

function Save-ConfigToEnv {
    param([string]$EnvPath, [hashtable]$Values)
    foreach ($k in $Values.Keys) { Set-EnvValue -Path $EnvPath -Key $k -Value $Values[$k] }
}

function Show-ConfigDialog {
    param([string]$EnvPath)
    $existing = Read-EnvFile -Path $EnvPath

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Manga Translator — Cấu hình'
    $form.Size = New-Object System.Drawing.Size(520, 420)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false

    $lblKey = New-Object System.Windows.Forms.Label
    $lblKey.Text = 'Khoá API OpenAI (bắt đầu bằng sk-):'
    $lblKey.Location = New-Object System.Drawing.Point(12, 15)
    $lblKey.AutoSize = $true
    $form.Controls.Add($lblKey)

    $txtKey = New-Object System.Windows.Forms.TextBox
    $txtKey.Location = New-Object System.Drawing.Point(12, 38)
    $txtKey.Width = 380
    $txtKey.UseSystemPasswordChar = $true
    if ($existing.ContainsKey('OPENAI_API_KEY')) { $txtKey.Text = $existing['OPENAI_API_KEY'] }
    $form.Controls.Add($txtKey)

    $btnShow = New-Object System.Windows.Forms.Button
    $btnShow.Text = 'Hiện'
    $btnShow.Location = New-Object System.Drawing.Point(400, 36)
    $btnShow.Width = 80
    $btnShow.Add_Click({ $txtKey.UseSystemPasswordChar = -not $txtKey.UseSystemPasswordChar })
    $form.Controls.Add($btnShow)

    $btnCheck = New-Object System.Windows.Forms.Button
    $btnCheck.Text = 'Kiểm tra khoá'
    $btnCheck.Location = New-Object System.Drawing.Point(12, 70)
    $btnCheck.Width = 120
    $lblVerdict = New-Object System.Windows.Forms.Label
    $lblVerdict.Location = New-Object System.Drawing.Point(140, 75)
    $lblVerdict.AutoSize = $true
    $btnCheck.Add_Click({
        $base = 'https://api.openai.com/v1'
        $verdict = Test-OpenAiKey -Key $txtKey.Text -BaseUrl $base -Invoker ${function:Invoke-OpenAiModelsCall}
        $msg = @{
            'ok'      = 'Khoá dùng được.'
            'invalid' = 'Khoá bị từ chối (401). Kiểm tra lại.'
            'network' = 'Không nối được mạng — chưa kết luận được về khoá.'
            'unknown' = 'Máy chủ trả mã lạ, chưa kết luận được.'
        }[$verdict]
        $lblVerdict.Text = $msg
    })
    $form.Controls.Add($btnCheck)
    $form.Controls.Add($lblVerdict)

    $lblModel = New-Object System.Windows.Forms.Label
    $lblModel.Text = 'Model dịch:'
    $lblModel.Location = New-Object System.Drawing.Point(12, 110)
    $lblModel.AutoSize = $true
    $form.Controls.Add($lblModel)

    $cmbModel = New-Object System.Windows.Forms.ComboBox
    $cmbModel.Location = New-Object System.Drawing.Point(12, 133)
    $cmbModel.Width = 468
    $cmbModel.DropDownStyle = 'DropDown'
    # Nhãn lấy nguyên văn từ .env.example, không viết lại.
    $cmbModel.Items.AddRange(@('gpt-4o', 'gpt-4o-mini')) | Out-Null
    $cmbModel.Text = 'gpt-4o'
    if ($existing.ContainsKey('OPENAI_MODEL')) { $cmbModel.Text = $existing['OPENAI_MODEL'] }
    $form.Controls.Add($cmbModel)

    $lblHint = New-Object System.Windows.Forms.Label
    $lblHint.Text = "gpt-4o: chọn đại từ/xưng hô tiếng Việt tự nhiên hơn hẳn, vài xu mỗi trang.`ngpt-4o-mini: rẻ và nhanh hơn nhưng dịch máy móc hơn."
    $lblHint.Location = New-Object System.Drawing.Point(12, 160)
    $lblHint.AutoSize = $true
    $form.Controls.Add($lblHint)

    $grpAdv = New-Object System.Windows.Forms.GroupBox
    $grpAdv.Text = 'Nâng cao (không cần điền)'
    $grpAdv.Location = New-Object System.Drawing.Point(12, 200)
    $grpAdv.Size = New-Object System.Drawing.Size(468, 130)
    $form.Controls.Add($grpAdv)

    $advKeys = @('OPENAI_API_BASE', 'GEMINI_API_KEY', 'DEEPL_AUTH_KEY')
    $advBoxes = @{}
    $y = 22
    foreach ($k in $advKeys) {
        $l = New-Object System.Windows.Forms.Label
        $l.Text = $k
        $l.Location = New-Object System.Drawing.Point(10, ($y + 3))
        $l.Width = 140
        $grpAdv.Controls.Add($l)
        $t = New-Object System.Windows.Forms.TextBox
        $t.Location = New-Object System.Drawing.Point(155, $y)
        $t.Width = 300
        if ($existing.ContainsKey($k)) { $t.Text = $existing[$k] }
        $grpAdv.Controls.Add($t)
        $advBoxes[$k] = $t
        $y += 30
    }

    $lblWarn = New-Object System.Windows.Forms.Label
    $lblWarn.Text = 'Gemini và DeepL chưa từng được kiểm chứng thực tế.'
    $lblWarn.Location = New-Object System.Drawing.Point(10, $y)
    $lblWarn.AutoSize = $true
    $grpAdv.Controls.Add($lblWarn)

    $btnOk = New-Object System.Windows.Forms.Button
    $btnOk.Text = 'Lưu'
    $btnOk.Location = New-Object System.Drawing.Point(300, 345)
    $btnOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Controls.Add($btnOk)
    $form.AcceptButton = $btnOk

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = 'Huỷ'
    $btnCancel.Location = New-Object System.Drawing.Point(390, 345)
    $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($btnCancel)
    $form.CancelButton = $btnCancel

    while ($true) {
        if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $false }
        if (Test-KeyFormat -Key $txtKey.Text) { break }
        [System.Windows.Forms.MessageBox]::Show(
            'Khoá API không hợp lệ. Phải bắt đầu bằng "sk-" và không được để trống.',
            'Lỗi', 'OK', 'Error') | Out-Null
    }

    $values = @{ OPENAI_API_KEY = $txtKey.Text.Trim(); OPENAI_MODEL = $cmbModel.Text.Trim() }
    foreach ($k in $advKeys) { $values[$k] = $advBoxes[$k].Text.Trim() }
    Save-ConfigToEnv -EnvPath $EnvPath -Values $values
    return $true
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/ConfigDialog.Tests.ps1 -Output Detailed`
Expected: PASS, 12 test

- [ ] **Step 5: Commit**

```bash
git add lib/ConfigDialog.ps1 tests/ConfigDialog.Tests.ps1
git commit -m "Add the API key and model configuration dialog

The key is checked against the real API before the 10-30 minute image
build, so a wrong key fails in seconds rather than after the build.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `lib/ExtensionGuide.ps1` — hướng dẫn nạp extension

**Files:**
- Create: `lib/ExtensionGuide.ps1`
- Test: `tests/ExtensionGuide.Tests.ps1`

**Interfaces:**
- Consumes: `Get-InstalledBrowsers`, `Open-UrlInBrowser` (Task 7)
- Produces: `Get-GuideSteps [string]$ExtensionPath` (trả `[string[]]`), `Show-ExtensionGuide [string]$Root`

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/ExtensionGuide.Tests.ps1
BeforeAll {
    . "$PSScriptRoot/../lib/BrowserDetect.ps1"
    . "$PSScriptRoot/../lib/ExtensionGuide.ps1"
}

Describe 'Get-GuideSteps' {
    BeforeAll { $script:steps = Get-GuideSteps -ExtensionPath 'C:\app\extension' }
    It 'có đúng bốn bước' { $steps.Count | Should -Be 4 }
    It 'bước cuối là kiểm chứng bằng nút Test kết nối của popup' {
        $steps[3] | Should -BeLike '*Test kết nối*'
    }
    It 'nhắc bật Developer mode ở bước đầu' { $steps[0] | Should -BeLike '*Developer mode*' }
    It 'nhúng đúng đường dẫn extension vào bước chọn thư mục' {
        $steps[2] | Should -BeLike '*C:\app\extension*'
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/ExtensionGuide.Tests.ps1 -Output Detailed`
Expected: FAIL — `The term 'Get-GuideSteps' is not recognized`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
# lib/ExtensionGuide.ps1
function Get-GuideSteps {
    param([string]$ExtensionPath)
    return @(
        '1. Bật công tắc "Developer mode" ở góc trên bên phải trang vừa mở.',
        '2. Bấm nút "Load unpacked".',
        "3. Chọn thư mục này (đã copy sẵn vào clipboard): $ExtensionPath",
        '4. Bấm biểu tượng extension trên thanh công cụ, rồi bấm "Test kết nối". Thấy báo OK là xong.'
    )
}

function Show-ExtensionGuide {
    param([string]$Root)
    $extPath = Join-Path $Root 'extension'
    Set-Clipboard -Value $extPath
    Start-Process explorer.exe -ArgumentList $extPath

    $browsers = Get-InstalledBrowsers
    if ($browsers.Count -gt 0) {
        Open-UrlInBrowser -BrowserPath $browsers[0].Path -Url 'chrome://extensions'
    }

    Add-Type -AssemblyName System.Windows.Forms
    $text = (Get-GuideSteps -ExtensionPath $extPath) -join "`n`n"
    [System.Windows.Forms.MessageBox]::Show(
        "$text`n`nĐường dẫn đã nằm sẵn trong clipboard, chỉ cần dán vào ô chọn thư mục.",
        'Bước cuối: nạp extension vào trình duyệt', 'OK', 'Information') | Out-Null
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/ExtensionGuide.Tests.ps1 -Output Detailed`
Expected: PASS, 4 test

- [ ] **Step 5: Commit**

```bash
git add lib/ExtensionGuide.ps1 tests/ExtensionGuide.Tests.ps1
git commit -m "Guide the user through loading the unpacked extension

Chrome removed --load-extension in 137 and the workarounds in 142, so
this step is guided rather than automated. Verification reuses the
popup's existing connection test instead of test-page.html, whose images
are gitignored and therefore missing from the downloaded ZIP.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: `setup.ps1` — wizard 8 bước

**Files:**
- Create: `setup.ps1`
- Test: `tests/Setup.Tests.ps1`

**Interfaces:**
- Consumes: toàn bộ `lib/*` từ Task 1-10
- Produces: `Get-SetupSteps` (trả `[string[]]` tên 8 bước), `Invoke-Setup [string]$Root [bool]$DryRun` (trả `[int]` exit code)

`-DryRun` chạy hết mọi bước kiểm tra và in ra những gì nó *sẽ* làm, nhưng không build, không tạo shortcut, không ghi `.env`.

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/Setup.Tests.ps1
BeforeAll { . "$PSScriptRoot/../setup.ps1" -AsModule }

Describe 'Get-SetupSteps' {
    It 'có đúng 8 bước, đúng thứ tự spec' {
        $s = Get-SetupSteps
        $s.Count | Should -Be 8
        $s[0] | Should -BeLike '*Kiểm tra máy*'
        $s[3] | Should -BeLike '*Cấu hình*'
        $s[4] | Should -BeLike '*Build*'
        $s[7] | Should -BeLike '*extension*'
    }
    It 'đặt bước cấu hình TRƯỚC bước build' {
        $s = Get-SetupSteps
        $cfg = [array]::FindIndex($s, [Predicate[string]] { param($x) $x -like '*Cấu hình*' })
        $bld = [array]::FindIndex($s, [Predicate[string]] { param($x) $x -like '*Build*' })
        $cfg | Should -BeLessThan $bld
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/Setup.Tests.ps1 -Output Detailed`
Expected: FAIL — không tìm thấy `setup.ps1`

- [ ] **Step 3: Viết implementation tối thiểu**

```powershell
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
    $freeGb = Get-FreeSpaceGb -Path $env:LOCALAPPDATA
    if (-not (Test-EnoughDisk -FreeGb $freeGb -RequiredGb 20.0)) {
        Write-Err "Cần ít nhất 20 GB trống, ổ đĩa hiện còn $freeGb GB."
        Write-Err 'Chỗ tốn dung lượng là file vhdx của WSL2, không phải thư mục cài.'
        return 1
    }
    Write-Ok "Còn trống $freeGb GB."

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
        Write-Ok 'Đã phát hiện GPU NVIDIA.'
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
            Write-Err 'Backend không sẵn sàng sau 10 phút. Xem log: docker logs manga_translator'
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
    $code = Invoke-Setup -Root $PSScriptRoot -DryRun ([bool]$DryRun)
    Stop-SetupTranscript
    exit $code
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/Setup.Tests.ps1 -Output Detailed`
Expected: PASS, 2 test

- [ ] **Step 5: Chạy thử chế độ khô**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1 -DryRun`
Expected: in đủ 8 bước, không build, không tạo shortcut, không mở hộp thoại nào

- [ ] **Step 6: Commit**

```bash
git add setup.ps1 tests/Setup.Tests.ps1
git commit -m "Add the 8-step idempotent setup wizard with -DryRun

Configuration comes before the build so a wrong API key fails in seconds
instead of after 10-30 minutes. Readiness and the end-to-end self-test
are the same operation: retrying a real translate until a status-0 frame
comes back.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: `start.ps1`, `configure.ps1`, `uninstall.ps1`

**Files:**
- Create: `start.ps1`, `configure.ps1`, `uninstall.ps1`

**Interfaces:**
- Consumes: `lib/*` từ Task 1-10
- Produces: (không có hàm nào cho task sau dùng)

`configure.ps1` phải **tạo lại** container chứ không `docker restart`: `OPENAI_MODEL` chỉ được nạp lúc tạo container, nên `restart` sẽ âm thầm giữ model cũ.

- [ ] **Step 1: Viết `start.ps1`**

```powershell
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
Write-Warn 'Đóng cửa sổ này là tắt backend.'
Wait-Job $job | Out-Null
```

- [ ] **Step 2: Viết `configure.ps1`**

```powershell
# configure.ps1
$root = $PSScriptRoot
foreach ($m in @('Ui', 'EnvFile', 'ConfigDialog', 'BackendControl', 'Preflight')) { . (Join-Path $root "lib/$m.ps1") }
Initialize-Ui

$envPath = Join-Path $root '.env'
Initialize-EnvFile -Path $envPath -ExamplePath (Join-Path $root '.env.example')
if (-not (Show-ConfigDialog -EnvPath $envPath)) { exit 0 }
Write-Ok 'Đã lưu cấu hình.'

# PHẢI tạo lại container, KHÔNG dùng docker restart: OPENAI_MODEL chỉ được nạp
# lúc tạo container nên restart sẽ âm thầm giữ model cũ.
Write-Warn 'Đang khởi động lại backend để áp dụng cấu hình mới...'
Stop-Backend -ContainerName 'manga_translator'
Write-Ok 'Xong. Bấm shortcut "Bật Manga Translator" để chạy lại với cấu hình mới.'
Read-Host 'Enter để đóng'
```

- [ ] **Step 3: Viết `uninstall.ps1`**

```powershell
# uninstall.ps1
$root = $PSScriptRoot
foreach ($m in @('Ui', 'Shortcut', 'BackendControl')) { . (Join-Path $root "lib/$m.ps1") }
Initialize-Ui

Write-Step 'Gỡ cài đặt Manga Translator'
$answer = Read-Host 'Xoá container, image (16 GB) và toàn bộ thư mục cài? (c/k)'
if ($answer -ne 'c') { exit 0 }

Stop-Backend -ContainerName 'manga_translator'
docker image rm 'manga-translator-patched:local' 2>$null | Out-Null
Remove-AppShortcuts
Write-Ok 'Đã gỡ shortcut, container và image.'
Write-Warn "Thư mục cài còn lại tại: $root"
Write-Warn 'Xoá nốt bằng tay nếu muốn (không tự xoá được vì script đang chạy trong đó).'
Read-Host 'Enter để đóng'
```

- [ ] **Step 4: Kiểm tra cú pháp cả ba file**

Run: `foreach ($f in 'start.ps1','configure.ps1','uninstall.ps1') { $null = [System.Management.Automation.PSParser]::Tokenize((Get-Content $f -Raw), [ref]$null); "$f OK" }`
Expected: cả ba in ra OK, không có lỗi parse

- [ ] **Step 5: Commit**

```bash
git add start.ps1 configure.ps1 uninstall.ps1
git commit -m "Add launcher, reconfigure and uninstall entry points

configure.ps1 recreates the container instead of restarting it, because
OPENAI_MODEL is only read at container creation time and a restart would
silently keep the old model.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: `bootstrap.ps1` và `install.bat`

**Files:**
- Create: `bootstrap.ps1`, `install.bat`
- Test: `tests/Bootstrap.Tests.ps1`

**Interfaces:**
- Consumes: (không có — `bootstrap.ps1` phải chạy được khi máy CHƯA có gì)

> **Bổ sung sau khi lập kế hoạch (2026-08-19):** `bootstrap.ps1` nhận thêm tham số
> `-InstallDir` để người dùng có ổ C: chật cài sang ổ khác; mặc định vẫn là
> `%LOCALAPPDATA%\MangaTranslator`. Lý do: trên chính máy phát triển, C: chỉ còn
> 13 GB trong khi D: còn 114 GB và E: còn 185 GB. Người dùng đã dời chỗ lưu Docker
> sang ổ khác là chuyện phổ biến, và họ cũng sẽ muốn đặt thư mục cài cùng chỗ.
- Produces: `Get-PreservedNames` (trả `[string[]]`), `Copy-ReleaseTree [string]$SourceDir [string]$TargetDir [string[]]$PreserveNames`, `Invoke-Bootstrap [string]$ZipUrl [string]$InstallDir`

`bootstrap.ps1` là **updater**: giữ lại `.env`, `.docker-image-hash`, `result`, `logs` khi ghi đè.

- [ ] **Step 1: Viết test thất bại**

```powershell
# tests/Bootstrap.Tests.ps1
BeforeAll { . "$PSScriptRoot/../bootstrap.ps1" -AsModule }

Describe 'Get-PreservedNames' {
    It 'giữ .env — nếu mất thì người dùng phải nhập lại khoá API' {
        Get-PreservedNames | Should -Contain '.env'
    }
    It 'giữ marker hash để không build lại 30 phút vô cớ' {
        Get-PreservedNames | Should -Contain '.docker-image-hash'
    }
    It 'giữ result/ và logs/' {
        Get-PreservedNames | Should -Contain 'result'
        Get-PreservedNames | Should -Contain 'logs'
    }
}

Describe 'Copy-ReleaseTree' {
    BeforeEach {
        $script:src = Join-Path $TestDrive ([guid]::NewGuid())
        $script:dst = Join-Path $TestDrive ([guid]::NewGuid())
        New-Item -ItemType Directory $src -Force | Out-Null
        New-Item -ItemType Directory $dst -Force | Out-Null
        Set-Content (Join-Path $src 'setup.ps1') 'moi' -Encoding UTF8
    }
    It 'ghi đè file mã nguồn bằng bản mới' {
        Set-Content (Join-Path $dst 'setup.ps1') 'cu' -Encoding UTF8
        Copy-ReleaseTree -SourceDir $src -TargetDir $dst -PreserveNames (Get-PreservedNames)
        (Get-Content (Join-Path $dst 'setup.ps1') -Raw).Trim() | Should -Be 'moi'
    }
    It 'KHÔNG đụng tới .env đã có' {
        Set-Content (Join-Path $dst '.env') 'OPENAI_API_KEY=sk-cua-toi' -Encoding UTF8
        Copy-ReleaseTree -SourceDir $src -TargetDir $dst -PreserveNames (Get-PreservedNames)
        (Get-Content (Join-Path $dst '.env') -Raw).Trim() | Should -Be 'OPENAI_API_KEY=sk-cua-toi'
    }
    It 'không nổ khi thư mục đích trống (cài mới)' {
        { Copy-ReleaseTree -SourceDir $src -TargetDir $dst -PreserveNames (Get-PreservedNames) } | Should -Not -Throw
        Test-Path (Join-Path $dst 'setup.ps1') | Should -BeTrue
    }
}
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/Bootstrap.Tests.ps1 -Output Detailed`
Expected: FAIL — không tìm thấy `bootstrap.ps1`

- [ ] **Step 3: Viết `bootstrap.ps1`**

```powershell
# bootstrap.ps1
# Vừa là installer vừa là updater: chỉ có MỘT đường code cho cài mới, cài lại
# và cập nhật. Chạy được cả khi máy chưa có gì (không phụ thuộc lib/).
param([switch]$AsModule)

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
    $installDir = Join-Path $env:LOCALAPPDATA 'MangaTranslator'
    exit (Invoke-Bootstrap -ZipUrl $ZIP_URL -InstallDir $installDir)
}
```

- [ ] **Step 4: Viết `install.bat`**

```bat
@echo off
chcp 65001 >nul
echo Dang tai trinh cai dat Manga Translator...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/bootstrap.ps1' -OutFile \"$env:TEMP\mot-bootstrap.ps1\"; & \"$env:TEMP\mot-bootstrap.ps1\""
pause
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests/Bootstrap.Tests.ps1 -Output Detailed`
Expected: PASS, 6 test

- [ ] **Step 6: Commit**

```bash
git add bootstrap.ps1 install.bat tests/Bootstrap.Tests.ps1
git commit -m "Add the one-file bootstrapper that doubles as the updater

Preserves .env, the image hash marker, result/ and logs/ when
overwriting, so updating never costs the user their API key or an
unnecessary 30 minute rebuild.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Làm cứng `/fetch-image` (retry + ép IPv4)

**Files:**
- Create: `patches/http_retry.py`
- Modify: `patches/main.py` (hàm `fetch_image`, quanh dòng 404-415)
- Modify: `Dockerfile` (thêm một dòng COPY)
- Test: `tests/test_http_retry.py`

**Interfaces:**
- Consumes: (không có)
- Produces: `fetch_with_retry(url: str, headers: dict, attempts: int = 3, client_factory=None) -> httpx.Response`

Đo được ngày 2026-08-18: `/fetch-image` trả 502 khoảng 4% khi bật Cloudflare WARP (WARP bật: 5/8 thành công, 3/8 hỏng ở đúng 21.0s; WARP tắt: 10/10, connect 0.65s). Người dùng cuối ở Việt Nam nhiều khả năng phải dùng VPN nên sẽ gặp đúng lỗi này.

Tách thành file riêng vì `patches/main.py` import cả FastAPI app, không import được trong test.

- [ ] **Step 1: Viết test thất bại**

```python
# tests/test_http_retry.py
# Chay: docker cp patches/http_retry.py manga_translator:/tmp/http_retry.py
#       docker exec -i manga_translator python - < tests/test_http_retry.py
import sys, asyncio
sys.path.insert(0, "/tmp")
import httpx
from http_retry import fetch_with_retry

def make_factory(script):
    """script: danh sach 'fail' hoac ma HTTP. Dem so lan thu that su."""
    calls = {"n": 0}
    def factory():
        def handler(request):
            i = calls["n"]
            calls["n"] += 1
            step = script[min(i, len(script) - 1)]
            if step == "fail":
                raise httpx.ConnectError("gia lap loi mang")
            return httpx.Response(step, content=b"anh")
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return factory, calls

async def main():
    # 1. Thanh cong ngay lan dau -> chi 1 lan goi
    f, calls = make_factory([200])
    r = await fetch_with_retry("https://x/a.avif", {}, client_factory=f)
    assert r.status_code == 200, r.status_code
    assert calls["n"] == 1, calls["n"]

    # 2. Hong 2 lan roi thanh cong -> phai thu lai va tra ve ket qua tot
    f, calls = make_factory(["fail", "fail", 200])
    r = await fetch_with_retry("https://x/a.avif", {}, client_factory=f)
    assert r.status_code == 200, r.status_code
    assert calls["n"] == 3, calls["n"]

    # 3. Hong het -> nem loi cuoi cung, KHONG thu qua so lan cho phep
    f, calls = make_factory(["fail"])
    try:
        await fetch_with_retry("https://x/a.avif", {}, attempts=3, client_factory=f)
        raise AssertionError("phai nem loi khi tat ca deu hong")
    except httpx.HTTPError:
        pass
    assert calls["n"] == 3, calls["n"]

    # 4. Loi HTTP that (404) KHONG duoc retry - do la cau tra loi hop le cua CDN
    f, calls = make_factory([404])
    r = await fetch_with_retry("https://x/a.avif", {}, client_factory=f)
    assert r.status_code == 404
    assert calls["n"] == 1, calls["n"]

    print("TAT CA TEST PASS")

asyncio.run(main())
```

- [ ] **Step 2: Chạy test, xác nhận nó fail**

Run:
```bash
docker cp patches/http_retry.py manga_translator:/tmp/http_retry.py 2>&1 || echo "chua co file - dung nhu ky vong"
docker exec -i manga_translator python - < tests/test_http_retry.py
```
Expected: FAIL — `ModuleNotFoundError: No module named 'http_retry'`

- [ ] **Step 3: Viết implementation tối thiểu**

```python
# patches/http_retry.py
"""Tai anh tu CDN co retry va ep IPv4.

Do duoc 2026-08-18: khi may co Cloudflare WARP bat, connect toi CDN anh hong
khoang 4% (o dung ~21s) va cac lan thanh cong cung mat 2.5-10s; tat WARP thi
10/10 thanh cong trong 0.65s. Nguoi dung cuoi o Viet Nam nhieu kha nang phai
dung VPN nen se gap dung loi nay.

Ep IPv4 bang local_address="0.0.0.0": CDN co ca ban ghi A lan AAAA nhung
container khong co route IPv6, nen nhanh IPv6 luon hong tuc thi va httpx bao
LEN chinh loi cua nhanh do ("Network is unreachable") du loi that nam o nhanh
IPv4 - thong bao gay hieu sai. Ep IPv4 don luon cai nhieu do.
"""
import asyncio

import httpx

CONNECT_TIMEOUT = 8.0
READ_TIMEOUT = 30.0


def _default_client_factory():
    return httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(
            connect=CONNECT_TIMEOUT, read=READ_TIMEOUT, write=READ_TIMEOUT, pool=CONNECT_TIMEOUT
        ),
        transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
    )


async def fetch_with_retry(url, headers, attempts=3, client_factory=None):
    """Tra ve httpx.Response. Chi retry loi TANG VAN CHUYEN (httpx.HTTPError).

    Ma loi HTTP that (403/404...) KHONG duoc retry: do la cau tra loi hop le
    cua CDN, thu lai chi ton thoi gian.
    """
    factory = client_factory or _default_client_factory
    last_err = None
    for attempt in range(attempts):
        try:
            async with factory() as client:
                return await client.get(url, headers=headers)
        except httpx.HTTPError as e:
            last_err = e
            if attempt < attempts - 1:
                await asyncio.sleep(0.5 * (2 ** attempt))
    raise last_err
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run:
```bash
docker cp patches/http_retry.py manga_translator:/tmp/http_retry.py
docker exec -i manga_translator python - < tests/test_http_retry.py
```
Expected: `TAT CA TEST PASS`

- [ ] **Step 5: Nối vào `patches/main.py`**

Sửa hàm `fetch_image` (dòng 404-415). **Lưu ý:** `patches/main.py` có BOM UTF-8 — đọc bằng `utf-8-sig` nếu sửa bằng script.

```python
from http_retry import fetch_with_retry   # them cung cac import khac o dau file

@app.post("/fetch-image", tags=["internal-api"])
async def fetch_image(data: FetchImageRequest) -> Response:
    headers = {"Referer": data.referer} if data.referer else {}
    try:
        resp = await fetch_with_retry(data.url, headers)
    except httpx.HTTPError as e:
        raise HTTPException(502, detail=f"Khong tai duoc anh sau 3 lan thu: {e}")
    if resp.status_code >= 400:
        raise HTTPException(resp.status_code, detail=f"CDN tra ve loi HTTP {resp.status_code}")
    content_type = resp.headers.get("content-type", "application/octet-stream")
    return Response(content=resp.content, media_type=content_type)
```

- [ ] **Step 6: Thêm dòng COPY vào `Dockerfile`**

```dockerfile
# Retry + ep IPv4 cho /fetch-image (xem patches/http_retry.py). Tach file rieng
# de test duoc doc lap voi FastAPI app.
COPY patches/http_retry.py /app/server/http_retry.py
```

- [ ] **Step 7: Build lại và xác nhận endpoint còn sống**

Run:
```bash
docker build -t manga-translator-patched:local .
powershell -NoProfile -ExecutionPolicy Bypass -File run-backend.ps1
```
Sau khi backend lên, ở cửa sổ khác:
```bash
curl.exe -s -X POST http://127.0.0.1:5003/fetch-image -H "Content-Type: application/json" -d "{\"url\":\"https://a1.gold-usergeneratedcontent.net/khong-ton-tai.avif\"}" -o - -w "\nHTTP %{http_code}\n"
```
Expected: `HTTP 404` (CDN trả 404 thật, được truyền nguyên mã — chứng minh lỗi HTTP không bị retry thành 502)

- [ ] **Step 8: Commit**

```bash
git add patches/http_retry.py patches/main.py Dockerfile tests/test_http_retry.py
git commit -m "Retry transient fetch-image failures and force IPv4

Measured: with Cloudflare WARP on, connects to the image CDN failed ~4%
of the time at a consistent 21s and successful ones took 2.5-10s; with
WARP off, 10/10 succeeded in 0.65s. End users are likely to be behind a
VPN, so the handler now retries transport errors three times with
backoff. Real HTTP statuses are passed through unretried.

Forcing IPv4 also removes a misleading error: the CDN publishes AAAA
records, the container has no IPv6 route, and httpx surfaced that
branch's instant 'Network is unreachable' while the real ~21s failure
was on IPv4.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: `run-backend.ps1` thành lớp mỏng, và tài liệu

**Files:**
- Modify: `run-backend.ps1` (thay toàn bộ)
- Create: `INSTALL.md`
- Modify: `README.md` (thêm mục cài đặt lên đầu)

**Interfaces:**
- Consumes: `lib/BackendControl.ps1`, `lib/EnvFile.ps1`, `lib/Preflight.ps1`, `lib/Ui.ps1`
- Produces: (không có)

Viết lại `run-backend.ps1` để không tồn tại hai bản logic docker-args trôi dạt khỏi nhau — chính kiểu trùng lặp đó đã đẻ ra lỗi che secret đã sửa ở Task 3.

- [ ] **Step 1: Thay `run-backend.ps1`**

```powershell
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
```

- [ ] **Step 2: Viết `INSTALL.md`**

```markdown
# Cài đặt Manga Translator

## Yêu cầu

- Windows 10 hoặc 11, 64-bit
- Ít nhất **20 GB trống** trên ổ C:
- Khoá API OpenAI (lấy tại https://platform.openai.com/api-keys)
- Khuyến nghị: GPU NVIDIA. Không có vẫn chạy được nhưng rất chậm.

## Các bước

1. Tải file **`install.bat`** ở mục Releases.
2. Bấm đúp vào nó.
3. Windows sẽ hiện cảnh báo màu xanh **"Windows protected your PC"**. Đây là
   chuyện bình thường với phần mềm không mua chứng chỉ ký. Bấm **More info**
   rồi bấm **Run anyway**.
4. Làm theo hướng dẫn trên màn hình. Lần đầu sẽ mất **10-30 phút** để tải bộ
   máy dịch (khoảng 16 GB) — cứ để yên, đừng tắt cửa sổ.
5. Khi hiện hộp thoại, dán khoá API OpenAI vào rồi bấm **Kiểm tra khoá** để
   chắc chắn khoá dùng được, rồi bấm **Lưu**.
6. Ở bước cuối, làm theo 4 bước để nạp extension vào trình duyệt.

## Dùng hàng ngày

Bấm đúp shortcut **"Bật Manga Translator"** ngoài Desktop, chờ tới khi hiện
**ĐÃ SẴN SÀNG**, rồi vào trang truyện bấm **Alt+D**.

Đóng cửa sổ đó là tắt.

## Đổi khoá API hoặc model

Start Menu → thư mục **Manga Translator** → **Cài đặt Manga Translator**.

## Cập nhật

Start Menu → thư mục **Manga Translator** → **Cập nhật Manga Translator**.
Khoá API và bản dịch đã lưu đều được giữ nguyên.

## Gỡ cài đặt

Start Menu → thư mục **Manga Translator** → **Gỡ cài đặt Manga Translator**.
```

- [ ] **Step 3: Thêm mục cài đặt lên đầu `README.md`**

Chèn ngay dưới tiêu đề chính của `README.md`:

```markdown
## Cài đặt cho người dùng cuối

Tải `install.bat` ở mục Releases rồi bấm đúp. Xem [INSTALL.md](INSTALL.md).
Phần còn lại của tài liệu này là ghi chép kỹ thuật cho người phát triển.
```

- [ ] **Step 4: Chạy toàn bộ test để chắc không vỡ gì**

Run: `Import-Module Pester -MinimumVersion 5.0 -Force; Invoke-Pester -Path tests -Output Detailed`
Expected: PASS toàn bộ, 0 fail

- [ ] **Step 5: Commit**

```bash
git add run-backend.ps1 INSTALL.md README.md
git commit -m "Reduce run-backend.ps1 to a thin layer and document install

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Kiểm tra thủ công trên máy thật (người, không phải agent)

**Files:** (không sửa file nào — đây là cửa nghiệm thu)

Không có bước nào ở đây tự động hoá được. Dự án này đã có tiền lệ rõ: mọi bug thật đều chỉ lộ ra khi chạy thật, không phải qua review hay unit test.

- [ ] **Step 1: Chạy khô**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1 -DryRun`
Expected: in đủ 8 bước, không build, không tạo shortcut, không mở hộp thoại

> **CHẶN TRƯỚC KHI CHẠY STEP 2:** `install.bat` và `bootstrap.ps1` đều trỏ URL vào nhánh
> `main`, mà toàn bộ công việc này đang ở `feature/local-installer`. Chạy `install.bat` bây
> giờ sẽ tải ZIP của `main` — trong đó KHÔNG có `setup.ps1` — và `bootstrap.ps1` sẽ ném lỗi.
> Phải merge trước, HOẶC sửa tạm hai URL đó trỏ vào nhánh rồi mới chạy. Kèm theo: `INSTALL.md`
> bảo người dùng tải `install.bat` "ở mục Releases", mà chưa có release nào được tạo — phải
> tạo release, hoặc sửa lại câu đó.

- [ ] **Step 2: Cài sạch từ đầu**

Đổi tên `%LOCALAPPDATA%\MangaTranslator` thành `...-backup`, xoá image
(`docker image rm manga-translator-patched:local`), rồi chạy `install.bat`.
Expected: đi hết 8 bước, self-test báo số vùng chữ, ba shortcut xuất hiện

- [ ] **Step 3: Kiểm tra các nhánh hỏng**

- [ ] Nhập khoá API sai → hộp thoại báo "Khoá bị từ chối (401)" **trước** khi build
- [ ] Tắt mạng rồi bấm "Kiểm tra khoá" → báo lỗi mạng, **không** báo khoá sai
- [ ] Tắt Docker Desktop rồi bấm shortcut "Bật" → tự mở Docker và chờ
- [ ] **Đóng cửa sổ launcher rồi chạy `docker ps`** → xác nhận container đã dừng.
      `start.ps1` có `finally` gọi `Stop-Backend`, nhưng PowerShell KHÔNG trap được
      nút X, nên đây là thứ duy nhất chứng minh được lời nhắc trên màn hình có đúng
      hay không. Nếu container vẫn chạy, sửa lời nhắc chứ đừng hứa điều không làm được.
- [ ] **Máy CHƯA cài Docker** (máy khác, hoặc gỡ Docker Desktop trước) → wizard đề nghị
      `winget install`, cài xong nhận biết trạng thái cần khởi động lại, và chạy lại
      `install.bat` sau reboot thì đi tiếp được. Đây là nhánh DUY NHẤT chưa có bất kỳ
      lớp test nào phủ, mà lại là thứ đầu tiên người dùng mới gặp.

- [ ] **Step 4: Chạy lại setup lần hai (kiểm chứng tính idempotent)**

Expected: bỏ qua build, bỏ qua shortcut đã có, không tạo trùng

- [ ] **Step 5: Chế độ CPU**

Chạy trên máy không có GPU NVIDIA (hoặc tạm đổi tên `nvidia-smi.exe`).
Expected: cảnh báo chậm, hỏi xác nhận, docker args **không** có `--gpus` và `--use-gpu`

- [ ] **Step 6: Nạp extension trên cả ba trình duyệt**

Chrome, Edge, Cốc Cốc. Với mỗi cái: `chrome://extensions` mở đúng, Load unpacked
nhận thư mục, popup "Test kết nối" báo OK.

- [ ] **Step 7: Cập nhật giữ nguyên dữ liệu**

Bấm "Cập nhật Manga Translator".
Expected: `.env` còn nguyên khoá, **không** build lại, bản dịch trong cache còn nguyên

- [ ] **Step 8: Gemini và DeepL với khoá thật**

Hai engine này merge từ 2026-07-23 nhưng **chưa từng chạy thật lần nào**. Với
mỗi engine: điền khoá vào mục Nâng cao, chọn engine trong popup, dịch một trang.
Riêng DeepL phải xác nhận cặp `deepl` + `VIN` thật sự ra tiếng Việt — đây là thứ
duy nhất không suy ra được từ code, nó phụ thuộc việc API DeepL có chấp nhận
entry `'VIN': 'VI'` với hạng tài khoản đang dùng hay không.

- [ ] **Step 9: Gỡ cài đặt**

Expected: shortcut biến mất, container và image bị xoá, thư mục còn lại kèm lời
nhắc xoá tay

- [ ] **Step 3b: Nhánh build hỏng.** Đổi tạm `Dockerfile` thành lệnh sai (vd `FROM khong-ton-tai`)
      rồi chạy setup. Kỳ vọng: log build HIỆN RA trên màn hình trong lúc chạy, setup DỪNG với
      thông báo lỗi, và `.docker-image-hash` KHÔNG được ghi. Đây là nhánh từng bị lỗi
      im lặng (build hỏng bị coi là thành công), nên phải nhìn tận mắt một lần.

- [ ] **Step 3c: Cài vào ổ khác và cập nhật.** `install.bat -InstallDir "D:\Manga Translator"`
      (cố ý có DẤU CÁCH trong tên). Cài xong bấm "Cập nhật Manga Translator" trong Start Menu.
      Kỳ vọng: cập nhật ghi đè ĐÚNG thư mục D: đó, KHÔNG đẻ ra bản thứ hai ở
      `%LOCALAPPDATA%`, và `.env` còn nguyên khoá.

- [ ] **Step 3d: Đổi cấu hình.** Start Menu → "Cài đặt Manga Translator" → đổi model từ
      `gpt-4o` sang `gpt-4o-mini` → Lưu. Bật lại backend rồi chạy
      `docker inspect manga_translator --format '{{range .Config.Env}}{{println .}}{{end}}' | findstr OPENAI_MODEL`.
      Kỳ vọng: thấy model MỚI. Đây là thứ quy tắc "tạo lại container chứ không restart" sinh ra để bảo đảm.

- [ ] **Step 3e: Mở launcher lần thứ hai** trong khi đã có một cửa sổ đang chạy. Ghi lại
      chuyện gì xảy ra với cả hai. Giới hạn đã biết: mỗi lần chỉ một backend (cùng bind cổng 5003).

- [ ] **Step 3f: Backend chạy nhưng không dịch được.** Trong lúc launcher đang chờ, chạy
      `docker exec manga_translator pkill -f "manga_translator shared"` để giết executor mà giữ
      container sống. Kỳ vọng: launcher báo lỗi kèm hướng dẫn xem log. GHI CHÚ ĐÃ BIẾT:
      `start.ps1` chỉ in câu nhắc lệnh `docker logs`, KHÔNG tự in log như `setup.ps1` làm —
      đây là chỗ đã park có chủ đích, xác nhận nó không phải ngõ cụt là đủ.

- [ ] **Step 8b: Xác minh bản sửa 502 với VPN.** BẬT WARP (hoặc VPN đang dùng), đọc một
      chương trên nguồn truyện, xem `docker logs manga_translator | findstr 502`. Kỳ vọng:
      KHÔNG còn dòng 502 nào, hoặc ít hơn hẳn mức ~4% đã đo trước đây. Đây là bài nghiệm thu
      DUY NHẤT cho thay đổi backend của nhánh này (Task 14).

- [ ] **Step 9b: Nhật ký không lộ secret.** Sau một lượt cài thật, chạy
      `findstr /i "sk- Bearer" logs\*.log`. Kỳ vọng: KHÔNG khớp dòng nào. Spec mục 8.3 hứa điều này.

- [ ] **Step 9c: Cảnh báo SmartScreen.** Chỉ hiện với file THỰC SỰ tải từ Internet (có
      Mark-of-the-Web); chạy `install.bat` có sẵn trên máy sẽ KHÔNG hiện. Muốn kiểm đúng thứ
      người dùng gặp thì phải tải file qua trình duyệt rồi mới bấm đúp. Nếu bỏ qua bước này,
      phải sửa ảnh minh hoạ trong `INSTALL.md` cho khớp thực tế.

- [ ] **Step 10: Ghi kết quả**

Cập nhật mục "Progress Log" ở cuối kế hoạch này với những gì hỏng và đã sửa gì.

---

## Progress Log

Chép nguyên văn từ ledger thực thi. Mọi dòng `Ruling:` là một quyết định controller
tự ra thay người dùng, kèm cái giá phải trả nếu quyết sai.

- Task 1: complete (commits 004fd9f..0317bf4, review clean) — spec ✅, quality approved
- Task 1: minor (deferred): thiếu newline cuối file ở lib/Ui.ps1 và tests/Ui.Tests.ps1
- Task 1: minor (deferred): test Initialize-Ui đổi codepage console thật, không khôi phục (kế thừa từ chính brief)
- Task 2: review 1 — spec ✅, quality approved, 1 Important (BOM) + 2 Minor
- Task 2: Ruling: finding BOM là plan-mandated (code trong brief dùng Set-Content -Encoding UTF8, PS5.1 luôn ghi BOM) — QUYẾT ĐỊNH SỬA. Spec mục 6 yêu cầu giữ nguyên file người dùng; ghi thêm BOM đi ngược mục đích module. Tác động thực tế nhỏ (Get-Content -Encoding UTF8 tự bỏ BOM, dự án không dùng docker --env-file) nhưng bản sửa 1 dòng. Sai thì tốn: gần như không gì.
- Task 2: minor (deferred): Read-EnvFile bỏ luôn khoá có giá trị rỗng khỏi hashtable -> caller không phân biệt được "có dòng nhưng rỗng" với "không có dòng"
- Task 2: minor (deferred): Initialize-EnvFile không có test, Copy-Item không guard khi thiếu .env.example
- Task 2: Ruling: hệ quả của bản sửa BOM — .env giờ được ghi BOM-less, mà `Get-Content` KHÔNG kèm `-Encoding UTF8` trên PS 5.1 dùng ANSI codepage, nên đọc lại chữ có dấu sẽ mojibake trên máy không bật tuỳ chọn "UTF-8 worldwide". Production AN TOÀN (Read-EnvFile luôn truyền -Encoding UTF8); chỉ TEST bị ảnh hưởng, và trên máy này pass vì codepage đang là 65001. QUYẾT ĐỊNH: không sửa test Task 2 (đang pass, đúng hành vi), nhưng khi dispatch Task 9 phải yêu cầu assertion đọc `.env` dùng `-Encoding UTF8` để test đúng thật chứ không đúng nhờ may. Sai thì tốn: một test đỏ trên máy khác, phát hiện ngay lần chạy đầu.
- Task 2: fix round 1/5 (1 addressed [BOM], 1 open MỚI [StreamWriter không try/finally]; commits 45b4773..be2eec3)
- Task 2: minor (deferred): Set-EnvValue truncate-rồi-ghi (StreamWriter append=false) nên lỗi giữa lúc ghi làm .env của người dùng mất nội dung — không phải hồi quy (Set-Content cũ cũng vậy), plan không yêu cầu ghi nguyên tử. Ruling: hoãn. Sai thì tốn: rủi ro mất khoá API trong cửa sổ vài chục ms, người dùng nhập lại qua "Cài đặt".
- Ghi chú kiểm chứng (không phải finding): Save-ImageHashMarker của T4 cũng ghi BOM, NHƯNG Get-Content -Raw tự bỏ BOM khi decode nên so sánh hash vẫn đúng (đo thật: file có EF BB BF, đọc lại dài 6, -eq trả True). KHÔNG cần sửa T4. Đừng đi lại nhánh này.
- Task 2: Ruling: implementer agent chết 2 lần liên tiếp vì API error, cả 2 lần đúng ở bước git commit. Code fix đã hoàn chỉnh trong working tree do agent viết. QUYẾT ĐỊNH: controller tự chạy test (7/7 pass) và tự commit, KHÔNG resume lần 3. Lý do: phần còn lại chỉ là bookkeeping, không phải viết code; cổng chất lượng thật là scoped re-review và nó vẫn chạy đầy đủ trên diff này. Sai thì tốn: một commit không do agent tạo, nội dung không đổi.
- Task 2: fix round 2/5 (1 addressed [StreamWriter try/finally], 0 open; commits be2eec3..121facc)
- Task 2: complete (commits 0317bf4..121facc, review clean sau 2 fix round)
- Task 3: review 0 (tự phát hiện trước khi review): implementer phải lách `$Args` bị che bằng [CmdletBinding()]+[Parameter]. Nguyên nhân gốc là LỖI PLAN của tôi — tôi cảnh báo T11 đừng dùng $args rồi chính tôi đặt tên tham số $Args ở T3.
- Task 3: Ruling: ĐỔI TÊN tham số `Hide-Secrets -Args` thành `-Arguments`, bỏ workaround CmdletBinding. Lý do: cách lách chạy được nhưng vỡ âm thầm nếu ai sau này đơn giản hoá signature; T11/T12/T15 (3 chỗ gọi) chưa triển khai nên đổi giờ gần như miễn phí. Đã sửa plan + commit. Sai thì tốn: một vòng fix ở T3, các task sau không ảnh hưởng.
- Ghi chú phòng ngừa: đã quét TOÀN BỘ plan tìm tên tham số trùng biến tự động PowerShell (Args/Input/Error/Host/Home/Matches/This/Event/Sender/PSItem/Profile/PWD). Sau khi đổi $Args -> $Arguments thì KHÔNG còn chỗ nào. Lớp lỗi này đã đóng, không cần soi lại ở các task sau.
- Task 3: review 1 — spec ✅, quality approved, 1 Important (test không phủ "biến có mặt nhưng rỗng") + 2 Minor
- Task 3: Ruling: Important #1 là plan-mandated (test trong brief của tôi thiếu ca này) — QUYẾT ĐỊNH SỬA. Domain fact "truyền giá trị rỗng tệ hơn không truyền" chính là lý do module tồn tại; implementation đang đúng nhưng không có test nào chặn hồi quy. Gộp luôn Minor #2 (GEMINI_MODEL không xuất hiện trong test nào) vì cùng vùng sửa. Sai thì tốn: 2 test thừa.
- Task 3: minor (không sửa): Hide-Secrets dùng foreach thay pipeline như brief — hành vi y hệt, chỉ là style.
- Task 3: ⚠️ đã tự giải quyết: reviewer không xác minh được "Pester >=5 thắng ở CI". Không có CI trong dự án này; plan quy định lệnh chạy tường minh ở Global Constraints và Task 15 step 4 chạy full suite bằng đúng lệnh đó. Không phải gap.
- Ghi chú kiểm chứng (không phải finding): endpoint `/translate/with-form/json/stream` mà SelfTest.ps1 (T5) và setup.ps1 (T11) dùng ĐÃ được xác nhận có thật trong fixtures/openapi.json. Chưa gọi thử với backend đang chạy (container không bật lúc kiểm) — việc đó thuộc Task 16 step 2.
- Task 3: fix round 1/5 (2 addressed, 0 open; commits ea34e98..25c960d)
- Task 3: complete (commits 121facc..25c960d, review clean; kèm 1 commit sửa plan c485226)
- Task 4: review 1 — spec ✅, quality approved, 1 Important (log build lỗi bị rác NativeCommandError) + 1 Minor
- Task 4: Ruling: Important là plan-mandated (brief của tôi dùng `2>&1 | Tee-Object`). ĐO THẬT: 1 dòng stderr -> 8 dòng log, 6 dòng là boilerplate PowerShell; thêm `| ForEach-Object { "$_" }` -> 2 dòng sạch đúng nguyên văn, $LASTEXITCODE vẫn đúng. QUYẾT ĐỊNH SỬA: `Get-Content -Tail 20` là thông tin duy nhất người dùng nhận được sau lượt build lỗi 30 phút. Sai thì tốn: gần như không gì, đã đo.
- Task 4: minor (deferred): Push-Location $Root không guard Test-Path -> nếu $Root không tồn tại thì ném exception thay vì trả $false. Không sửa trong vòng này (minor không vào fix loop).
- Ghi chú kiểm chứng QUAN TRỌNG cho T6 (đo thật): với native exe ghi stderr rồi thoát 0, `$LASTEXITCODE` VẪN ĐÚNG (0), nhưng `$?` là False. Các hàm dò (Test-DockerDaemonReady/Test-NvidiaGpu/Test-WingetAvailable/Test-DockerImageExists) dùng $LASTEXITCODE nên ĐÚNG như plan viết. TUYỆT ĐỐI không đổi sang `$?` — sẽ báo "không có Docker" trên máy có Docker. Phải nói rõ điều này khi dispatch T6.
- Task 4: fix round 1/5 (1 addressed, 0 open; commits f7fb421..cc54b64)
- Task 4: complete (commits 25c960d..cc54b64, review clean)
- Task 5: complete (commits cc54b64..4e73e52, review clean) — spec ✅, approved, 0 fix round
- Task 5: LỖI PLAN #4 (implementer tự sửa đúng): brief viết `return $frames`, nhưng PS thu mảng 0 phần tử về $null và 1 phần tử về scalar -> chính test của brief sẽ fail. Sửa bằng `return ,$frames`. Reviewer đã tái hiện độc lập.
- Task 5: minor (deferred): curl -s + không kiểm exit code -> nếu probe hỏng vì lý do khác (sai ImagePath, thiếu curl, firewall) thì Wait-BackendReady quay vòng hết timeout mà không có tín hiệu chẩn đoán nào.
- Task 5: minor (deferred): mô tả test viết tiếng Anh, không đồng nhất với EnvFile/DockerImage (tiếng Việt) — repo chưa có quy ước thống nhất.
- Task 6: review 1 — spec ✅ nhưng quality NOT APPROVED: 1 Critical + 2 Important. Tất cả là LỖI PLAN #5 của tôi.
- Task 6: Ruling: Critical THẬT và phải sửa. `2>$null` KHÔNG bắt được CommandNotFoundException (lỗi phân giải lệnh xảy ra TRƯỚC khi process chạy), nên Test-NvidiaGpu ném exception trên đúng cái máy nó sinh ra để phát hiện: máy không có GPU thì không có nvidia-smi.exe. ĐÃ KIỂM CHỨNG: nhánh installer cũ của chính dự án (.claude/worktrees/feature+setup-installer/lib/SetupHelpers.ps1) CÓ try/catch — plan của tôi làm hồi quy so với code đã đúng.
- Task 6: Ruling: lỗi này LAN sang Task 4 đã complete — Test-DockerImageExists cũng thiếu try/catch. Sửa luôn trong cùng lượt dispatch này thay vì mở lại Task 4 riêng. Sai thì tốn: diff của T6 chạm vào file của T4, reviewer có thể nêu là ngoài phạm vi — đã nói trước với reviewer.
- Task 6: Ruling: Get-VramMbFromSmiOutput lấy match ĐẦU TIÊN, mà nvidia-smi thật in "512MiB / 4096MiB" (đã dùng trước, tổng sau) -> báo sai VRAM. Sửa thành lấy MAX của mọi số MiB (total >= used nên max luôn là total, đúng cho cả đầu vào một số). Hàm này hiện CHƯA ai gọi; spec mục 5 yêu cầu bước 3 đọc VRAM và cảnh báo nếu <4GB -> phải nối dây trong T11.
- Ruling (mang sang T12): quét toàn plan cho lớp lỗi "gọi native exe không guard". Chỗ còn phơi THẬT là uninstall.ps1: `Stop-Backend` (docker stop, ở file của T3) và `docker image rm` (file của T12) đều không guard, mà gỡ cài đặt CHÍNH LÀ luồng người dùng có thể đã xoá Docker Desktop trước -> script gỡ crash. QUYẾT ĐỊNH: gộp cả hai guard vào dispatch của T12 (T12 sẽ chạm file của T3, sẽ nói trước với reviewer). Các chỗ còn lại (docker build, Start-Backend, curl.exe) chỉ chạy SAU khi đã xác nhận Docker/curl sẵn sàng nên chấp nhận không guard.
- Task 6: fix round 1/5 (4 addressed: Critical + 2 Important + cross-task Test-DockerImageExists; commits ea196df..88324d1). Re-review phát hiện 1 Minor MỚI -> hoá ra là vấn đề hệ thống, xem dưới.
- Task 6: LỖI PLAN #6 (nặng nhất tới giờ): thiếu ràng buộc "mọi .ps1 phải UTF-8 CÓ BOM". PS 5.1 đọc source phi-ASCII không BOM bằng ANSI codepage -> mọi chuỗi tiếng Việt thành mojibake lúc chạy. Tôi đã đo encoding của CONSOLE (Initialize-Ui) nhưng chưa bao giờ đo encoding của SOURCE — hai tầng khác nhau, cần cả hai. ĐO THẬT trên bản copy: không BOM -> "KhÃ´ng xÃ¡c Ä‘á»‹nh...", có BOM -> "Không xác định được...".
- Task 6: Ruling: ĐO trạng thái hiện tại của cả 12 file -> 4 file có nội dung phi-ASCII mà KHÔNG có BOM (BackendControl.ps1 10 ký tự, Preflight.ps1 15, SelfTest.ps1 38, Preflight.Tests.ps1 11); Ui.ps1 có 54 ký tự kể cả ✓ ⚠ nhưng may là có BOM. QUYẾT ĐỊNH: (a) thêm ràng buộc vào Global Constraints của plan (đã commit), (b) sửa BOM cho 4 file, (c) thêm tests/Encoding.Tests.ps1 canh ràng buộc cho MỌI file — vì còn 11 file nữa sắp viết, toàn chữ tiếng Việt hướng tới người dùng. Sai thì tốn: một test hạ tầng thừa; nếu KHÔNG làm thì lỗi này tái diễn 11 lần nữa và chỉ lộ ra khi người dùng chạy thật.
- Task 6: fix round 2/5 (1 addressed [BOM 4 file] + thêm tests/Encoding.Tests.ps1 canh cho mọi file; commits 88324d1..b03df61; 47 test / 7 file đều pass)
- Ghi chú phòng ngừa (đã tách 16 khối PowerShell của task 7-15 ra kiểm): 0/16 khối có lỗi cú pháp (PSParser::Tokenize). Quét tiếp các lớp lỗi đã từng vấp: không còn `$?`, không còn `2>&1` chưa chuyển chuỗi, không còn tên tham số trùng biến tự động.
- Ghi chú: NGHI VẤN SAI đã loại bằng đo thật — tưởng `return $out` ở T7 (Get-BrowserListFromPaths) sẽ làm test `.Count | Should -Be 0` fail như T5. ĐO BẰNG PESTER THẬT: PASS, vì $null.Count trả 0 và Pester chấp nhận. KHÔNG sửa plan T7. (T5 cần `,$array` vì lý do khác: test ở đó index $f[0] trên mảng 1 phần tử, bị thu về scalar.)
- Ghi chú kỹ thuật cho mọi test file: hàm định nghĩa ở top-level KHÔNG thấy được trong `It` của Pester 5 — phải đặt trong `BeforeAll`. Các file test trong plan đều đã đúng.
- Task 6: fix round 2 re-review: cả A (BOM 4 file) và B (Encoding.Tests.ps1) đều ADDRESSED, 0 breakage mới
- Task 6: complete (commits 4e73e52..b03df61, review clean sau 2 fix round; kèm commit sửa plan cfe200e)
- Ruling: GỘP Task 7 + Task 8 vào một dispatch (BrowserDetect + Shortcut). Lý do: cả hai là module nhỏ độc lập, brief chứa code đầy đủ, chỉ là chép lại + chạy test; phiên đã chạm session limit một lần nên giảm số lượt dispatch. Review vẫn chạy đủ trên diff gộp. Sai thì tốn: một review surface to hơn, nếu rối thì tách lại.
- Task 7: complete (commit 62f69e8, review clean) — spec ✅, approved. Minor (deferred): HKLM thắng HKCU khi dò App Paths, ngược quy ước Windows thông thường nhưng brief không quy định.
- Task 8: complete (commit 3dd9ac1, review clean) — spec ✅, approved.
- Task 8: LỖI PLAN #7 (implementer tự sửa đúng): test `($plan | Where-Object {...}).Count | Should -Be 1` trong brief của tôi sẽ FAIL NGAY CẢ VỚI implementation ĐÚNG, vì pipeline trả 1 phần tử thì thu về scalar và scalar không có .Count. Sửa bằng `@(...)`. Reviewer tái hiện độc lập.
- Task 8: Ruling: Important (Remove-AppShortcuts hardcode 'Bật Manga Translator.lnk' thay vì lấy Name từ Get-ShortcutPlan -> đổi tên là uninstall bỏ sót shortcut Desktop) là plan-mandated. QUYẾT ĐỊNH SỬA, nhưng GỘP vào dispatch của Task 10 thay vì mở một lượt riêng — phiên đã chạm session limit, và review của T10 sẽ phủ luôn diff này (sẽ nói rõ với reviewer). Sai thì tốn: review surface của T10 to hơn một chút.
- Task 8: minor (deferred): New-AppShortcut không có ngữ nghĩa "sửa chữa" — .lnk cũ trỏ sai Root sẽ không bao giờ được cập nhật, chỉ no-op.
- Task 9: review 1 — spec ✅ nhưng quality NOT APPROVED: 1 Critical + 2 Minor. LỖI PLAN #8.
- Task 9: Ruling: Critical THẬT. Invoke-WebRequest trên PS 5.1 NÉM exception với mọi mã non-2xx (không có -SkipHttpErrorCheck, đó là PS6+), nên 401 "khoá sai" rơi vào catch của Test-OpenAiKey và bị báo thành 'network' — đảo ngược đúng cái phân biệt mà task sinh ra để làm, và test không bắt được vì test chỉ chạy qua Invoker giả. ĐO THẬT: khoá sai -> WebException CÓ .Response, [int]$resp.StatusCode = 401; host không tồn tại -> WebException KHÔNG có .Response. Tiêu chí phân biệt sạch. QUYẾT ĐỊNH SỬA + tách hàm thuần Get-StatusCodeFromWebException để có test. Sai thì tốn: gần như không gì, đã đo cả hai nhánh.
- Task 9: fix round 1/5 (1 addressed [401 vs network], 0 open; commits 23fd8d5..5984aab; 15 test ConfigDialog, 73 full suite)
- Task 9: complete (commits 3dd9ac1..5984aab, review clean sau 1 fix round)
- Task 9: minor (deferred): nút "Kiểm tra khoá" chặn UI tối đa 20s, không có phản hồi trung gian.
- Task 9: minor (deferred): chưa có hàm thuần cho việc map exception -> status code trước khi sửa; nay đã có Get-StatusCodeFromWebException.
- Ghi chú kiểm chứng: đối chiếu MỌI adapter ra thế giới thật (docker/Invoke-WebRequest/curl.exe/Start-Process/winget/ComObject) với checklist Task 16. Task 16 đã phủ đúng hai nhánh của bug Task 9 (Step 3). Lỗ hổng DUY NHẤT: nhánh winget cài Docker trên máy chưa có — đã bổ sung vào Task 16 và commit (71e90df).
- Task 10: review — Task 10 spec ✅/approved (1 Important kế thừa từ brief: bước 1 nói "trang vừa mở" kể cả khi không dò được browser nào). Bản sửa Shortcut: ❌ NOT APPROVED, Critical.
- Task 10: LỖI PLAN #9 và lần này là do CHÍNH TÔI viết code sửa trong chỉ thị mà không chạy thử: `Get-ShortcutPlan -Root ''` ném lỗi vì Join-Path không nhận -Path rỗng -> Remove-AppShortcuts crash MỌI lần gọi -> uninstall hỏng hoàn toàn, TỆ HƠN trước khi sửa. Test mới không bắt được vì nó gọi -Root 'C:\app' chứ không gọi đúng đường mà Remove-AppShortcuts đi.
- Task 10: Ruling: sửa bằng HẰNG SỐ DÙNG CHUNG ($script:DesktopShortcutName) cho cả hai hàm, bỏ hẳn việc gọi Get-ShortcutPlan với Root giả. ĐÃ THỬ NGHIỆM TRƯỚC KHI GIAO: hai bên khớp, không ném. Sai thì tốn: gần như không gì.
- Task 10: Ruling: KHÔNG viết test gọi thẳng Remove-AppShortcuts — nó xoá shortcut Desktop và thư mục Start Menu THẬT của máy đang chạy test. Hàm này chỉ kiểm được bằng tay, đã có ở Task 16 Step 9.
- Task 10: fix round 1 re-review: ADDRESSED, DRY giữ được (tên ở đúng 1 chỗ), không test nào gọi Remove-AppShortcuts, không breakage mới
- Task 10: complete (commits 71e90df..ffaf045, review clean sau 1 fix round) — gồm cả Task 10 và bản sửa Shortcut của Task 8
- Task 11: review 1 — spec ✅, quality approved, 3 Minor (đều kế thừa từ brief): (a) -DryRun không chặn Start-DockerDesktop/Wait-DockerDaemon và Read-Host khi không có GPU; (b) Get-SourceHash không try/catch nên thiếu Dockerfile sẽ ném ra ngoài, bỏ qua Stop-SetupTranscript; (c) logs/ chưa có trong .gitignore.
- Task 11: NGƯỜI DÙNG YÊU CẦU (2026-08-19): "Chạy thử ở ổ D hoặc E, không chạm vào ổ C". Điều tra ra LỖI THIẾT KẾ THẬT: phép kiểm dung lượng đo %LOCALAPPDATA% (C:) nhưng dữ liệu Docker của máy này nằm ở D:\Programs\docker\DockerDesktopWSL (xác nhận qua registry WSL BasePath VÀ CustomWslDistroDir trong settings-store.json; tìm thấy docker_data.vhdx 49.29GB trên D:). C: còn 13GB -> installer CHẶN OAN, trong khi ổ thật (D:) còn 114.7GB. Ảnh hưởng mọi người dùng đã dời dữ liệu Docker (rất phổ biến khi C: nhỏ).
- Task 11: Ruling: thêm Get-DockerDataPath (registry WSL -> settings-store.json -> mặc định %LOCALAPPDATA%\Docker) và dùng nó cho phép kiểm dung lượng thay vì %LOCALAPPDATA%. ĐÃ THỬ NGHIỆM nguyên mẫu: trả D:\Programs\docker\DockerDesktopWSL\main, 114.7GB, qua ngưỡng. Thông báo lỗi cũng nêu rõ ổ nào. Sai thì tốn: một vòng fix.
- Ruling (mang sang T13): bootstrap.ps1 nên nhận -InstallDir để người có C: chật cài sang ổ khác. Mặc định vẫn %LOCALAPPDATA%\MangaTranslator.
- Task 11: fix round 1 — controller tự chạy `setup.ps1 -DryRun` trên máy thật: qua đủ 8 bước, exit 0, báo "Ổ chứa dữ liệu Docker còn trống 114.7 GB (D:\Programs\docker\DockerDesktopWSL\main)" và "GPU NVIDIA (4096 MiB VRAM)", tiếng Việt đủ dấu, không build/không tạo gì.
- Ghi chú (không phải finding): bước 5 báo "SẼ build" dù image 16.4GB đã tồn tại, vì .docker-image-hash chưa có. Lượt build đó sẽ dùng lại layer cache (Dockerfile+patches không đổi) nên xong trong vài giây, không phải 30 phút. Không sửa.
- Task 11: fix round 1/5 re-review: ADDRESSED, 0 breakage mới (Get-FreeSpaceGb đã có guard nên đường dẫn lạ fail-loud thay vì rơi nhầm ổ)
- Task 11: complete (commits ffaf045..2271c5c, review clean sau 1 fix round; 83 test)
- Task 12: review 1 — spec ✅, approved, 2 Important + 2 Minor. Cả 2 Important đều kế thừa từ brief của tôi.
- Task 12: Ruling: SỬA cả hai Important vì cả hai đều là NÓI SAI SỰ THẬT với người dùng. (a) uninstall.ps1 hỏi xin phép xoá "toàn bộ thư mục cài" rồi không xoá — prompt phá huỷ mà mô tả sai việc mình làm là không chấp nhận được. (b) start.ps1 hứa "đóng cửa sổ là tắt backend" mà không có gì bảo đảm; setup.ps1 còn dựa vào giả định NGƯỢC LẠI. Sửa thành: try/finally gọi Stop-Backend (phủ Ctrl+C và thoát bình thường) + đổi lời hứa thành câu đúng, kèm lệnh dự phòng. KHÔNG hứa chặn được nút X vì PowerShell không trap được force-close. Sai thì tốn: một vòng fix.
- Task 12: minor (deferred): configure.ps1 dot-source lib/Preflight.ps1 nhưng không gọi hàm nào (import chết, kế thừa từ brief).
- Task 12: minor (deferred): 3 script mới thiếu newline cuối file, khác quy ước các file khác trong repo.
- Task 12: fix round 1/5 (1 addressed [prompt uninstall], 1 NOT ADDRESSED [lời nhắc start.ps1 vẫn liệt kê "đóng cửa sổ" ngang hàng Ctrl+C]; commits 259c453..17b40a5)
- Task 12: Ruling: reviewer đúng — chỉ Ctrl+C mới chạy được finally, nên câu "Nhấn Ctrl+C HOẶC đóng cửa sổ này để dừng backend" vẫn là lời hứa sai. Sửa thành chỉ Ctrl+C; dòng dự phòng `docker stop manga_translator` đã lo trường hợp đóng cửa sổ.
- Task 12: Ruling: "breakage mới" (finally có thể dừng container mà cửa sổ này không khởi động) — KHÔNG chấp nhận là breakage mới. Hai container KHÔNG THỂ chạy cùng lúc (cả hai đều bind cổng 5003), nên start.ps1 buộc phải Stop-Backend TRƯỚC khi khởi động cái của nó — hành vi đó đã có sẵn từ brief, không phải do bản fix sinh ra. finally chỉ đối xứng với nó. Ghi nhận là giới hạn đã biết: mỗi lần một backend. Sai thì tốn: người dùng mở 2 launcher thì cái trước bị dừng — đã đúng như vậy từ trước.
- Task 12: fix round 2/5 (1 addressed [lời nhắc chỉ còn Ctrl+C], 0 open; commits 17b40a5..3036b52)
- Task 12: complete (commits 2271c5c..3036b52, review clean sau 2 fix round)
- Task 13: review 1 — spec ✅, approved, 1 Important (rò thư mục temp ở 2 nhánh lỗi của Invoke-Bootstrap) + 4 Minor
- Task 13: Ruling: SỬA Important (try/finally dọn temp). Kế thừa từ brief của tôi. Mỗi lần cài/cập nhật hỏng để lại một thư mục mot-<guid> trong TEMP vĩnh viễn.
- Task 13: Ruling: SỬA luôn finding 5 (install.bat không truyền được -InstallDir) dù reviewer xếp là "note, not a defect". Lý do: người dùng vừa YÊU CẦU cài off C:, mà luồng "tải một file duy nhất" là luồng họ sẽ dùng — thêm tham số vào bootstrap.ps1 nhưng để install.bat không với tới được thì tính năng coi như không tồn tại với người dùng thật. ĐÃ THỬ NGHIỆM cách truyền `%*` qua .bat: chạy đúng cả khi có lẫn không có tham số. Sai thì tốn: một dòng trong .bat.
- Task 13: minor (deferred): thông báo "Gói tải về không đúng cấu trúc mong đợi" không nói người dùng phải làm gì; $ZIP_ROOT_NAME hardcode (nhưng fail an toàn, có guard); nhánh fallback của -InstallDir không có test (nằm trong `if (-not $AsModule)` nên harness không vào được).
- Task 13: fix round 1/5 (2 addressed [dọn temp bằng try/finally, install.bat truyền %*], 0 open; commits 043f4af..04b449a)
- Task 13: complete (commits 3036b52..04b449a, review clean sau 1 fix round; 89 test)
- Task 14: Ruling: KHÔNG chạy `docker build` trong task này. Container manga_translator ĐANG CHẠY (người dùng bật lại để đọc truyện), và rebuild sẽ thay image họ đang dùng. Người dùng chưa trả lời câu hỏi về thời điểm rebuild, và thông báo nền KHÔNG phải là sự đồng ý. Làm hết phần code + test (test chạy qua `docker cp` + `docker exec` vào container đang chạy, chỉ ghi vào /tmp, không phá gì), để lượt build thật cho người dùng / Task 16 step 2. Hệ quả đúng ý đồ: Dockerfile+patches đổi -> Get-SourceHash đổi -> installer sẽ tự rebuild ở lần chạy thật đầu tiên.
- Task 14: review 1 — spec ✅, approved (bước rebuild bỏ qua ĐÚNG theo ruling của tôi). 2 điểm "Important nhưng không chặn" + 2 Minor.
- Task 14: complete (commits 04b449a..95b1cf3, review clean, 0 fix round) — 89 test PowerShell + test Python pass trong container, main.py giữ BOM.
- Task 14: Ruling: SỬA connect timeout 8s -> 12s. Lý do: đo thật cho thấy connect thành công (WARP bật) trải từ 2.5s tới 10s; timeout 8s sẽ HUỶ những kết nối lẽ ra thành công, biến chúng thành lỗi. Biến "chậm mà được" thành "hỏng" tệ hơn là chờ lâu trên nhánh vốn đã hỏng. Đánh đổi: worst case 3 lần thử tăng từ ~25.5s lên ~37.5s, chỉ xảy ra trên đường đã thất bại. GỘP vào dispatch Task 15 (khác file, không xung đột) thay vì mở vòng fix riêng — phiên đã chạm session limit 2 lần. Sai thì tốn: một ảnh hiếm hoi quay lâu hơn.
- Task 14: minor (deferred): thông báo lỗi hardcode "sau 3 lan thu" trong khi attempts là default của hàm -> có thể lệch nếu đổi default; import `from http_retry import` khác quy ước package-style của các patch khác (chạy đúng, chỉ là khác kiểu).
- Task 14: minor (deferred): worst case 25.5s (nay 37.5s) không bị client cắt — background.js gọi /fetch-image không đặt AbortSignal. Trần độ trễ, không phải lỗi chức năng.
- Task 15: complete (commits 95b1cf3..cb9f1c1, review clean, 0 fix round, 0 finding) — kèm bản sửa CONNECT_TIMEOUT 8->12 của T14
- Task 15: implementer tự bắt được 1 chỗ INSTALL.md nói sai so với code (yêu cầu "20 GB trên ổ C:" trong khi code dò đúng thư mục dữ liệu Docker) và sửa theo code. Reviewer xác nhận bản sửa đúng và không còn chỗ sai nào khác.
- TẤT CẢ 15 task code HOÀN TẤT. Task 16 là checklist người thật, không thuộc phạm vi agent.

## Review toàn nhánh (opus) — KHÔNG ĐẠT, 2 Critical + 6 Important
- Critical #1 ĐÃ TỰ KIỂM CHỨNG trên backend đang chạy: `-F "config=$cfg"` bị PS 5.1 nuốt mất dấu nháy kép -> server trả "Internal Server Error" (21 byte, 0 frame) -> Wait-BackendReady quay hết 600s -> setup CHẾT ở bước 6, KHÔNG BAO GIỜ tạo shortcut, và start.ps1 hằng ngày cũng vậy. Bản sửa (ghi config ra file, `-F "config=<file"`) ĐÃ THỬ: 20917 byte, 14 frame, kết thúc status=0 có bản dịch thật.
- Critical #2 ĐÃ TỰ KIỂM CHỨNG: Invoke-ImageBuild kết thúc pipeline bằng Tee-Object không ai tiêu thụ -> hàm trả Object[] gồm log + bool -> `-not $r` luôn False -> build HỎNG bị coi là THÀNH CÔNG, và toàn bộ log build 10-30 phút bị nuốt (người dùng nhìn cửa sổ đứng im).
- Cả 15 lượt review từng-task đều bỏ sót cả hai, vì chúng chỉ lộ ra khi chạy thật đầu-cuối.
- Reviewer BÁC BỎ 2 ruling của tôi và tôi đồng ý: (a) T5 "curl không kiểm exit code" tôi xếp minor — thực ra là thứ khuếch đại Critical #1 thành 10 phút treo im lặng; (b) T8 "shortcut không sửa chữa" tôi xếp minor — cộng với bug -InstallDir thì người cài off C: có shortcut trỏ mãi vào thư mục updater không còn quản.
- Ledger line 63 của tôi SAI: "setup.ps1 thoát thì container dừng theo" — không đúng, giết client docker trên Windows không dừng container.
- Fix wave sau review toàn nhánh: 8/8 fix xong, commit 310fa76, 90 test pass, setup.ps1 -DryRun vẫn qua đủ 8 bước exit 0.
- Fix 1 ĐÃ KIỂM CHỨNG SỐNG sau khi sửa: "20917 bytes, 14 frames, result frame: OK" (trước khi sửa: 21 byte, 0 frame, NULL).
- >>> NGƯỜI DÙNG YÊU CẦU TẠM DỪNG tại đây (2026-08-19).
- CÒN LẠI KHI QUAY LẠI: (1) một lượt scoped re-review duy nhất trên diff cb9f1c1..310fa76 để đóng fix wave; (2) vá 8 lỗ hổng của checklist Task 16 mà reviewer nêu (chưa làm); (3) bàn giao Task 16 cho người thật; (4) finishing-a-development-branch. KHÔNG có task code nào còn dang dở.
- Fix wave re-review: 7/8 ADDRESSED. Finding 3 PARTIALLY — start.ps1 chưa tự in `docker logs --tail 20` ở nhánh "container chạy nhưng không dịch được" (setup.ps1 thì có).
- Ruling: PARK finding 3 phần còn lại. Quy trình cấm đợt fix thứ hai sau review toàn nhánh, và đây không phải ngõ cụt — start.ps1 vẫn in đúng lệnh `docker logs manga_translator` để người dùng tự chạy. Đã thêm Step 3f vào checklist Task 16 để người thật xác nhận nó không phải ngõ cụt. Sai thì tốn: người dùng phải tự gõ một lệnh đã được in sẵn.
- Ruling: 2 Minor mới từ fix wave (New-AppShortcut giờ đọc .lnk cũ nên .lnk hỏng có thể ném COM; repair chỉ so Arguments chứ không so TargetPath) — KHÔNG sửa. Cái thứ nhất đã được try/catch top-level của setup.ps1 hứng thành thông báo tiếng Việt tử tế; cái thứ hai hẹp hơn trạng thái trước fix (vốn không sửa gì bao giờ). Sai thì tốn: gần như không gì.
- Đã vá 8 lỗ hổng checklist Task 16 (commit 798238b), gồm cảnh báo CHẶN: install.bat/bootstrap.ps1 trỏ vào `main` nên Step 2 không chạy được trước khi merge, và INSTALL.md trỏ tới Releases chưa tồn tại.

