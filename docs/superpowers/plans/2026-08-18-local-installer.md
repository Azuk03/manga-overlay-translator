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

- [ ] **Step 2: Cài sạch từ đầu**

Đổi tên `%LOCALAPPDATA%\MangaTranslator` thành `...-backup`, xoá image
(`docker image rm manga-translator-patched:local`), rồi chạy `install.bat`.
Expected: đi hết 8 bước, self-test báo số vùng chữ, ba shortcut xuất hiện

- [ ] **Step 3: Kiểm tra các nhánh hỏng**

- [ ] Nhập khoá API sai → hộp thoại báo "Khoá bị từ chối (401)" **trước** khi build
- [ ] Tắt mạng rồi bấm "Kiểm tra khoá" → báo lỗi mạng, **không** báo khoá sai
- [ ] Tắt Docker Desktop rồi bấm shortcut "Bật" → tự mở Docker và chờ

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

- [ ] **Step 10: Ghi kết quả**

Cập nhật mục "Progress Log" ở cuối kế hoạch này với những gì hỏng và đã sửa gì.

---

## Progress Log

(Điền trong lúc thực hiện.)
