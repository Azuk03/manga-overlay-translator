# Distribution Installer (setup.bat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a few trusted, non-technical Windows users clone/download this repo, double-click `setup.bat`, and end up with a working local backend + installed userscript, without hand-editing any file.

**Architecture:** A set of small, independently-testable PowerShell helper functions under `lib/` (Docker/GPU detection, `.env` read/write, Docker-image rebuild-hash detection, desktop shortcut creation, a WinForms API-key dialog), composed by one orchestrator script `setup.ps1` (invoked via `setup.bat`) that implements the 6-step flow from the design spec. `run-backend.ps1` is modified to reuse the same GPU-detection/arg-building helpers so day-to-day startup gets the same CPU-fallback behavior as first-time setup.

**Tech Stack:** PowerShell 5.1 (built-in on Windows), .NET WinForms (built-in, no install), Docker CLI, Pester v5 (dev-only, for unit tests of the pure-logic helpers).

## Global Constraints

- Windows-only. No macOS/Linux support, no cross-platform shims.
- No new runtime dependency or framework beyond what's already in the repo (Docker, PowerShell, WinForms). Pester is dev-only (needed to run tests, never shipped/required for end users).
- All scripts must be safe to re-run any number of times (idempotent) — re-running never duplicates `.env` lines, never recreates an existing shortcut, never rebuilds the Docker image unless `Dockerfile`/`patches/` actually changed.
- API key validation rule (used everywhere a key is accepted): non-empty after `.Trim()`, and starts with `"sk-"`.
- Whenever no NVIDIA GPU is detected, a highly visible warning must be printed **both** during `setup.ps1` and every time `run-backend.ps1` starts — never silently degrade to CPU.
- GitHub repo for `@updateURL`/`@downloadURL` and the "open install page" step: `https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/manga-overlay-translator.user.js`.
- Spec reference for all design decisions: `docs/superpowers/specs/2026-07-19-distribution-installer-design.md`.

---

### Task 1: Core helper functions — Docker/GPU detection, API key format, docker run args

**Files:**
- Create: `lib/SetupHelpers.ps1`
- Test: `lib/SetupHelpers.Tests.ps1`

**Interfaces:**
- Produces:
  - `Test-DockerReady` — no params, returns `[bool]` (true if `docker version` exits 0)
  - `Test-NvidiaGpu` — no params, returns `[bool]` (true if `nvidia-smi` exits 0)
  - `Test-ApiKeyFormat -Key [string]` — returns `[bool]`
  - `Build-DockerRunArgs -EnvVars [hashtable] -HasGpu [bool] -ContainerName [string] -ResultDir [string]` — returns `[string[]]` array of docker CLI args (same shape as the array currently built inline in `run-backend.ps1`)

- [ ] **Step 1: Confirm Pester v5 is available**

Run: `Get-Module -ListAvailable Pester | Select-Object Name, Version`
Expected: at least one entry with `Version` 5.x or higher. If none, run `Install-Module -Name Pester -Force -SkipPublisherCheck -MinimumVersion 5.0` first.

- [ ] **Step 2: Write the failing tests**

Create `lib/SetupHelpers.Tests.ps1`:

```powershell
BeforeAll {
    . "$PSScriptRoot/SetupHelpers.ps1"
}

Describe "Test-ApiKeyFormat" {
    It "returns false for empty string" {
        Test-ApiKeyFormat -Key "" | Should -BeFalse
    }
    It "returns false for whitespace only" {
        Test-ApiKeyFormat -Key "   " | Should -BeFalse
    }
    It "returns false for a key missing the sk- prefix" {
        Test-ApiKeyFormat -Key "abc123" | Should -BeFalse
    }
    It "returns true for a valid sk- prefixed key" {
        Test-ApiKeyFormat -Key "sk-abc123" | Should -BeTrue
    }
    It "trims surrounding whitespace before checking the prefix" {
        Test-ApiKeyFormat -Key "  sk-abc123  " | Should -BeTrue
    }
}

Describe "Test-DockerReady" {
    It "returns true when docker exits with code 0" {
        Mock -CommandName docker -MockWith { $global:LASTEXITCODE = 0 }
        Test-DockerReady | Should -BeTrue
    }
    It "returns false when docker exits with a non-zero code" {
        Mock -CommandName docker -MockWith { $global:LASTEXITCODE = 1 }
        Test-DockerReady | Should -BeFalse
    }
}

Describe "Test-NvidiaGpu" {
    It "returns true when nvidia-smi exits with code 0" {
        Mock -CommandName nvidia-smi -MockWith { $global:LASTEXITCODE = 0 }
        Test-NvidiaGpu | Should -BeTrue
    }
    It "returns false when nvidia-smi exits with a non-zero code" {
        Mock -CommandName nvidia-smi -MockWith { $global:LASTEXITCODE = 1 }
        Test-NvidiaGpu | Should -BeFalse
    }
}

Describe "Build-DockerRunArgs" {
    BeforeEach {
        $script:envVars = @{ OPENAI_API_KEY = "sk-test" }
    }

    It "includes --gpus all and --use-gpu when HasGpu is true" {
        $dockerArgs = Build-DockerRunArgs -EnvVars $script:envVars -HasGpu $true -ContainerName "test_container" -ResultDir "C:/result"
        $dockerArgs | Should -Contain "--gpus"
        $dockerArgs | Should -Contain "--use-gpu"
    }

    It "excludes --gpus and --use-gpu when HasGpu is false" {
        $dockerArgs = Build-DockerRunArgs -EnvVars $script:envVars -HasGpu $false -ContainerName "test_container" -ResultDir "C:/result"
        $dockerArgs | Should -Not -Contain "--gpus"
        $dockerArgs | Should -Not -Contain "--use-gpu"
    }

    It "includes OPENAI_MODEL when present in EnvVars" {
        $script:envVars["OPENAI_MODEL"] = "gpt-4o-mini"
        $dockerArgs = Build-DockerRunArgs -EnvVars $script:envVars -HasGpu $true -ContainerName "test_container" -ResultDir "C:/result"
        ($dockerArgs -join " ") | Should -Match "OPENAI_MODEL=gpt-4o-mini"
    }

    It "omits OPENAI_API_BASE when not present in EnvVars" {
        $dockerArgs = Build-DockerRunArgs -EnvVars $script:envVars -HasGpu $true -ContainerName "test_container" -ResultDir "C:/result"
        ($dockerArgs -join " ") | Should -Not -Match "OPENAI_API_BASE"
    }

    It "uses the given container name" {
        $dockerArgs = Build-DockerRunArgs -EnvVars $script:envVars -HasGpu $true -ContainerName "my_container" -ResultDir "C:/result"
        $dockerArgs | Should -Contain "my_container"
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `Invoke-Pester -Path lib/SetupHelpers.Tests.ps1 -Output Detailed`
Expected: FAIL — `SetupHelpers.ps1` does not exist yet / functions not defined.

- [ ] **Step 4: Write the implementation**

Create `lib/SetupHelpers.ps1`:

```powershell
function Test-DockerReady {
    docker version *> $null
    return ($LASTEXITCODE -eq 0)
}

function Test-NvidiaGpu {
    nvidia-smi *> $null
    return ($LASTEXITCODE -eq 0)
}

function Test-ApiKeyFormat {
    param([string]$Key)
    if ([string]::IsNullOrWhiteSpace($Key)) { return $false }
    return $Key.Trim().StartsWith("sk-")
}

function Build-DockerRunArgs {
    param(
        [hashtable]$EnvVars,
        [bool]$HasGpu,
        [string]$ContainerName,
        [string]$ResultDir
    )

    $dockerArgs = @(
        "run", "--rm",
        "--name", $ContainerName,
        "-p", "5003:5003",
        "-p", "8000:8000",
        "-p", "8001:8001",
        "--ipc=host"
    )

    if ($HasGpu) {
        $dockerArgs += @("--gpus", "all")
    }

    $dockerArgs += @(
        "--entrypoint", "python",
        "-v", "$ResultDir:/app/result",
        "-e", "OPENAI_API_KEY=$($EnvVars['OPENAI_API_KEY'])"
    )

    if ($EnvVars.ContainsKey("OPENAI_MODEL")) {
        $dockerArgs += @("-e", "OPENAI_MODEL=$($EnvVars['OPENAI_MODEL'])")
    }
    if ($EnvVars.ContainsKey("OPENAI_API_BASE")) {
        $dockerArgs += @("-e", "OPENAI_API_BASE=$($EnvVars['OPENAI_API_BASE'])")
    }

    $dockerArgs += @(
        "manga-translator-patched:local",
        "server/main.py", "--start-instance", "--host=0.0.0.0", "--port=5003"
    )

    if ($HasGpu) {
        $dockerArgs += "--use-gpu"
    }

    $dockerArgs += @("--models-ttl", "0", "--nonce", "None")

    return $dockerArgs
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `Invoke-Pester -Path lib/SetupHelpers.Tests.ps1 -Output Detailed`
Expected: PASS — all `Describe` blocks green.

- [ ] **Step 6: Commit**

```bash
git add lib/SetupHelpers.ps1 lib/SetupHelpers.Tests.ps1
git commit -m "Add Docker/GPU detection and docker-arg-building helpers"
```

---

### Task 2: `.env` read/write helpers

**Files:**
- Create: `lib/EnvFile.ps1`
- Test: `lib/EnvFile.Tests.ps1`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `Get-EnvApiKey -EnvPath [string]` — returns `[string]` or `$null` if file missing / key missing / key empty
  - `Set-EnvApiKey -EnvPath [string] -EnvExamplePath [string] -ApiKey [string]` — creates `.env` from `.env.example` if missing, writes/updates the `OPENAI_API_KEY` line, no return value

- [ ] **Step 1: Write the failing tests**

Create `lib/EnvFile.Tests.ps1`:

```powershell
BeforeAll {
    . "$PSScriptRoot/EnvFile.ps1"
}

Describe "Get-EnvApiKey" {
    It "returns null when the .env file does not exist" {
        Get-EnvApiKey -EnvPath "$TestDrive/missing.env" | Should -BeNullOrEmpty
    }

    It "returns null when OPENAI_API_KEY is present but empty" {
        Set-Content -Path "$TestDrive/empty.env" -Value @("OPENAI_API_KEY=", "OPENAI_MODEL=gpt-4o-mini")
        Get-EnvApiKey -EnvPath "$TestDrive/empty.env" | Should -BeNullOrEmpty
    }

    It "returns the key value when present" {
        Set-Content -Path "$TestDrive/filled.env" -Value @("OPENAI_API_KEY=sk-realkey", "OPENAI_MODEL=gpt-4o-mini")
        Get-EnvApiKey -EnvPath "$TestDrive/filled.env" | Should -Be "sk-realkey"
    }
}

Describe "Set-EnvApiKey" {
    BeforeEach {
        Set-Content -Path "$TestDrive/example.env.example" -Value @(
            "# comment",
            "OPENAI_API_KEY=",
            "OPENAI_MODEL=gpt-4o-mini",
            "BACKEND_PORT="
        )
    }

    It "creates .env from .env.example when .env does not exist" {
        $envPath = "$TestDrive/new.env"
        Set-EnvApiKey -EnvPath $envPath -EnvExamplePath "$TestDrive/example.env.example" -ApiKey "sk-first"
        Test-Path $envPath | Should -BeTrue
        Get-EnvApiKey -EnvPath $envPath | Should -Be "sk-first"
    }

    It "updates an existing key on the second call instead of duplicating the line" {
        $envPath = "$TestDrive/existing.env"
        Set-EnvApiKey -EnvPath $envPath -EnvExamplePath "$TestDrive/example.env.example" -ApiKey "sk-first"
        Set-EnvApiKey -EnvPath $envPath -EnvExamplePath "$TestDrive/example.env.example" -ApiKey "sk-second"
        Get-EnvApiKey -EnvPath $envPath | Should -Be "sk-second"
        $matches = Get-Content $envPath | Select-String "^OPENAI_API_KEY="
        $matches.Count | Should -Be 1
    }

    It "preserves other lines from .env.example" {
        $envPath = "$TestDrive/preserved.env"
        Set-EnvApiKey -EnvPath $envPath -EnvExamplePath "$TestDrive/example.env.example" -ApiKey "sk-first"
        (Get-Content $envPath) -join "`n" | Should -Match "OPENAI_MODEL=gpt-4o-mini"
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `Invoke-Pester -Path lib/EnvFile.Tests.ps1 -Output Detailed`
Expected: FAIL — `EnvFile.ps1` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/EnvFile.ps1`:

```powershell
function Get-EnvApiKey {
    param([string]$EnvPath)

    if (-not (Test-Path $EnvPath)) { return $null }

    $line = Get-Content $EnvPath | Where-Object { $_ -match '^\s*OPENAI_API_KEY\s*=\s*(.+)$' } | Select-Object -First 1
    if (-not $line) { return $null }

    $value = ($line -replace '^\s*OPENAI_API_KEY\s*=\s*', '').Trim()
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }

    return $value
}

function Set-EnvApiKey {
    param(
        [string]$EnvPath,
        [string]$EnvExamplePath,
        [string]$ApiKey
    )

    if (-not (Test-Path $EnvPath)) {
        Copy-Item $EnvExamplePath $EnvPath
    }

    $lines = Get-Content $EnvPath
    $found = $false
    $newLines = foreach ($line in $lines) {
        if ($line -match '^\s*OPENAI_API_KEY\s*=') {
            $found = $true
            "OPENAI_API_KEY=$ApiKey"
        } else {
            $line
        }
    }

    if (-not $found) {
        $newLines += "OPENAI_API_KEY=$ApiKey"
    }

    Set-Content -Path $EnvPath -Value $newLines
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `Invoke-Pester -Path lib/EnvFile.Tests.ps1 -Output Detailed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/EnvFile.ps1 lib/EnvFile.Tests.ps1
git commit -m "Add .env read/write helpers for API key configuration"
```

---

### Task 3: Docker image rebuild-hash detection

**Files:**
- Create: `lib/ImageHash.ps1`
- Test: `lib/ImageHash.Tests.ps1`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `Get-DockerImageHash -DockerfilePath [string] -PatchesDir [string]` — returns `[string]` lowercase hex SHA-256
  - `Test-NeedsRebuild -CurrentHash [string] -MarkerPath [string]` — returns `[bool]`
  - `Set-ImageHashMarker -Hash [string] -MarkerPath [string]` — writes the hash to the marker file, no return value

- [ ] **Step 1: Write the failing tests**

Create `lib/ImageHash.Tests.ps1`:

```powershell
BeforeAll {
    . "$PSScriptRoot/ImageHash.ps1"
}

Describe "Get-DockerImageHash" {
    BeforeEach {
        New-Item -Path "$TestDrive/patches" -ItemType Directory -Force | Out-Null
        Set-Content -Path "$TestDrive/Dockerfile" -Value "FROM test:latest"
        Set-Content -Path "$TestDrive/patches/a.yaml" -Value "key: value"
    }

    It "returns the same hash for unchanged files" {
        $hash1 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        $hash2 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        $hash1 | Should -Be $hash2
    }

    It "returns a different hash when a patch file's content changes" {
        $hash1 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        Set-Content -Path "$TestDrive/patches/a.yaml" -Value "key: changed"
        $hash2 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        $hash1 | Should -Not -Be $hash2
    }

    It "returns a different hash when the Dockerfile changes" {
        $hash1 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        Set-Content -Path "$TestDrive/Dockerfile" -Value "FROM test:changed"
        $hash2 = Get-DockerImageHash -DockerfilePath "$TestDrive/Dockerfile" -PatchesDir "$TestDrive/patches"
        $hash1 | Should -Not -Be $hash2
    }
}

Describe "Test-NeedsRebuild" {
    It "returns true when the marker file does not exist" {
        Test-NeedsRebuild -CurrentHash "abc123" -MarkerPath "$TestDrive/nomarker.txt" | Should -BeTrue
    }

    It "returns false when the marker matches the current hash" {
        Set-Content -Path "$TestDrive/marker.txt" -Value "abc123" -NoNewline
        Test-NeedsRebuild -CurrentHash "abc123" -MarkerPath "$TestDrive/marker.txt" | Should -BeFalse
    }

    It "returns true when the marker differs from the current hash" {
        Set-Content -Path "$TestDrive/marker2.txt" -Value "old-hash" -NoNewline
        Test-NeedsRebuild -CurrentHash "abc123" -MarkerPath "$TestDrive/marker2.txt" | Should -BeTrue
    }
}

Describe "Set-ImageHashMarker" {
    It "writes the hash so a following Test-NeedsRebuild call returns false" {
        Set-ImageHashMarker -Hash "abc123" -MarkerPath "$TestDrive/marker3.txt"
        Test-NeedsRebuild -CurrentHash "abc123" -MarkerPath "$TestDrive/marker3.txt" | Should -BeFalse
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `Invoke-Pester -Path lib/ImageHash.Tests.ps1 -Output Detailed`
Expected: FAIL — `ImageHash.ps1` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/ImageHash.ps1`:

```powershell
function Get-DockerImageHash {
    param(
        [string]$DockerfilePath,
        [string]$PatchesDir
    )

    $files = @(Get-Item $DockerfilePath) + (Get-ChildItem $PatchesDir -File -Recurse | Sort-Object FullName)

    $combined = New-Object System.Text.StringBuilder
    foreach ($file in $files) {
        [void]$combined.Append((Get-Content $file.FullName -Raw))
    }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($combined.ToString())
    $hashBytes = $sha256.ComputeHash($bytes)
    return [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLower()
}

function Test-NeedsRebuild {
    param(
        [string]$CurrentHash,
        [string]$MarkerPath
    )

    if (-not (Test-Path $MarkerPath)) { return $true }

    $storedHash = (Get-Content $MarkerPath -Raw).Trim()
    return ($storedHash -ne $CurrentHash)
}

function Set-ImageHashMarker {
    param(
        [string]$Hash,
        [string]$MarkerPath
    )

    Set-Content -Path $MarkerPath -Value $Hash -NoNewline
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `Invoke-Pester -Path lib/ImageHash.Tests.ps1 -Output Detailed`
Expected: PASS.

- [ ] **Step 5: Exclude the hash marker file from git**

The marker file (`.docker-image-hash`, created at the repo root by `setup.ps1` in Task 7) is per-machine build state, not source — it must never be committed. Add it to `.gitignore`.

Read the current `.gitignore` and append `.docker-image-hash` as a new line at the end (after the existing `*.webp` line added earlier in this project).

- [ ] **Step 6: Commit**

```bash
git add lib/ImageHash.ps1 lib/ImageHash.Tests.ps1 .gitignore
git commit -m "Add Docker image rebuild-hash detection helpers"
```

---

### Task 4: Desktop shortcut creation

**Files:**
- Create: `lib/Shortcut.ps1`
- Test: `lib/Shortcut.Tests.ps1`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `New-DesktopShortcut -ShortcutPath [string] -TargetPath [string] -Arguments [string] -WorkingDirectory [string]` — returns `[bool]` (`$true` if a new shortcut was created, `$false` if one already existed at that path)

- [ ] **Step 1: Write the failing tests**

Create `lib/Shortcut.Tests.ps1`:

```powershell
BeforeAll {
    . "$PSScriptRoot/Shortcut.ps1"
}

Describe "New-DesktopShortcut" {
    It "creates a .lnk file and returns true when it does not exist yet" {
        $shortcutPath = "$TestDrive/Bat Manga Translator.lnk"
        $created = New-DesktopShortcut -ShortcutPath $shortcutPath -TargetPath "powershell.exe" -Arguments "-NoExit -File test.ps1" -WorkingDirectory $TestDrive
        $created | Should -BeTrue
        Test-Path $shortcutPath | Should -BeTrue
    }

    It "returns false and does not error when the shortcut already exists" {
        $shortcutPath = "$TestDrive/Existing.lnk"
        New-DesktopShortcut -ShortcutPath $shortcutPath -TargetPath "powershell.exe" -Arguments "-NoExit" -WorkingDirectory $TestDrive | Out-Null
        $secondResult = New-DesktopShortcut -ShortcutPath $shortcutPath -TargetPath "powershell.exe" -Arguments "-NoExit" -WorkingDirectory $TestDrive
        $secondResult | Should -BeFalse
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `Invoke-Pester -Path lib/Shortcut.Tests.ps1 -Output Detailed`
Expected: FAIL — `Shortcut.ps1` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/Shortcut.ps1`:

```powershell
function New-DesktopShortcut {
    param(
        [string]$ShortcutPath,
        [string]$TargetPath,
        [string]$Arguments,
        [string]$WorkingDirectory
    )

    if (Test-Path $ShortcutPath) { return $false }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.Save()

    return $true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `Invoke-Pester -Path lib/Shortcut.Tests.ps1 -Output Detailed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/Shortcut.ps1 lib/Shortcut.Tests.ps1
git commit -m "Add desktop shortcut creation helper"
```

---

### Task 5: API key input dialog (WinForms GUI)

**Files:**
- Create: `lib/ApiKeyDialog.ps1`

**Interfaces:**
- Consumes: `Test-ApiKeyFormat` from `lib/SetupHelpers.ps1` (Task 1) — the caller is responsible for dot-sourcing `SetupHelpers.ps1` before this file.
- Produces:
  - `Show-ApiKeyPrompt -ExistingKey [string]` — returns `[string]` (validated key) or `$null` if the user cancels

This is a GUI component with no automated test (WinForms `ShowDialog()` blocks waiting for real user input and cannot run headless in Pester). It is verified manually in Step 2.

- [ ] **Step 1: Write the implementation**

Create `lib/ApiKeyDialog.ps1`:

```powershell
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-ApiKeyPrompt {
    param([string]$ExistingKey = "")

    while ($true) {
        $form = New-Object System.Windows.Forms.Form
        $form.Text = "Manga Overlay Translator - Cau hinh API Key"
        $form.Size = New-Object System.Drawing.Size(420, 160)
        $form.StartPosition = "CenterScreen"
        $form.FormBorderStyle = "FixedDialog"
        $form.MaximizeBox = $false

        $label = New-Object System.Windows.Forms.Label
        $label.Text = "Dan OpenAI API key cua ban (bat dau bang sk-):"
        $label.AutoSize = $true
        $label.Location = New-Object System.Drawing.Point(10, 15)
        $form.Controls.Add($label)

        $textbox = New-Object System.Windows.Forms.TextBox
        $textbox.Text = $ExistingKey
        $textbox.Location = New-Object System.Drawing.Point(10, 40)
        $textbox.Width = 380
        $form.Controls.Add($textbox)

        $okButton = New-Object System.Windows.Forms.Button
        $okButton.Text = "OK"
        $okButton.Location = New-Object System.Drawing.Point(230, 90)
        $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $form.Controls.Add($okButton)
        $form.AcceptButton = $okButton

        $cancelButton = New-Object System.Windows.Forms.Button
        $cancelButton.Text = "Huy"
        $cancelButton.Location = New-Object System.Drawing.Point(315, 90)
        $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
        $form.Controls.Add($cancelButton)
        $form.CancelButton = $cancelButton

        $result = $form.ShowDialog()
        if ($result -eq [System.Windows.Forms.DialogResult]::Cancel) {
            return $null
        }

        $key = $textbox.Text.Trim()
        if (Test-ApiKeyFormat -Key $key) {
            return $key
        }

        [System.Windows.Forms.MessageBox]::Show(
            "API key khong hop le. Phai bat dau bang 'sk-' va khong duoc de trong.",
            "Loi",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}
```

- [ ] **Step 2: Manually verify the dialog**

Run this ad-hoc from a PowerShell prompt in the `manga/` directory:

```powershell
. .\lib\SetupHelpers.ps1
. .\lib\ApiKeyDialog.ps1
Show-ApiKeyPrompt -ExistingKey ""
```

Expected behavior to confirm by hand:
1. A small window titled "Manga Overlay Translator - Cau hinh API Key" appears, centered on screen.
2. Typing `abc` and clicking OK shows an error message box ("API key khong hop le...") and the form reappears with the text preserved.
3. Typing `sk-test123` and clicking OK closes the dialog; the command returns `sk-test123`.
4. Re-running and clicking "Huy" (Cancel) returns `$null` (prints nothing / `$null` in the console).

- [ ] **Step 3: Commit**

```bash
git add lib/ApiKeyDialog.ps1
git commit -m "Add WinForms API key input dialog"
```

---

### Task 6: Wire GPU/CPU branching into `run-backend.ps1`

**Files:**
- Modify: `run-backend.ps1` (full file, currently 77 lines — see current content below)

**Interfaces:**
- Consumes: `Test-NvidiaGpu` and `Build-DockerRunArgs` from `lib/SetupHelpers.ps1` (Task 1).

**Current file content (for reference — replace entirely with the version in Step 2):**

```powershell
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
    "--ipc=host", "--gpus", "all",
    "--entrypoint", "python",
    "-v", "$PSScriptRoot/result:/app/result",
    "-e", "OPENAI_API_KEY=$($vars['OPENAI_API_KEY'])"
)

if ($vars.ContainsKey("OPENAI_MODEL")) {
    $dockerArgs += "-e"; $dockerArgs += "OPENAI_MODEL=$($vars['OPENAI_MODEL'])"
}
if ($vars.ContainsKey("OPENAI_API_BASE")) {
    $dockerArgs += "-e"; $dockerArgs += "OPENAI_API_BASE=$($vars['OPENAI_API_BASE'])"
}

$dockerArgs += @(
    "manga-translator-patched:local",
    "server/main.py", "--start-instance", "--host=0.0.0.0", "--port=5003",
    "--use-gpu", "--models-ttl", "0", "--nonce", "None"
)

Write-Host "Chay: docker $($dockerArgs -replace $vars['OPENAI_API_KEY'], '***REDACTED***')"
docker @dockerArgs
```

- [ ] **Step 1: Confirm current behavior before changing it**

Run: `Get-Content run-backend.ps1 | Select-String "gpus"`
Expected: one line containing `--ipc=host, --gpus, all` — confirms the file matches the reference above before editing.

- [ ] **Step 2: Replace the file content**

Replace the entire content of `run-backend.ps1` with:

```powershell
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
```

- [ ] **Step 3: Manually verify the GPU path (real machine, has NVIDIA GPU)**

Run: `.\run-backend.ps1`
Expected: no CPU warning banner printed; the `Chay: docker ...` line includes `--gpus all` and `--use-gpu`; container starts exactly as before this change (compare against the previous `docker ps` behavior you already know from prior sessions).

- [ ] **Step 4: Manually verify the CPU fallback path (session-scoped, non-destructive)**

Temporarily hide `nvidia-smi` from PATH for this PowerShell session only (does not affect the system or other terminals):

```powershell
$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -notmatch 'NVIDIA' }) -join ';'
.\run-backend.ps1
```

Expected: the yellow "KHONG PHAT HIEN GPU NVIDIA" banner prints before the `Chay: docker ...` line; that line does NOT contain `--gpus` or `--use-gpu`. Press Ctrl+C to stop the container, then open a fresh terminal (or start a new PowerShell session) so the modified `$env:PATH` doesn't linger.

- [ ] **Step 5: Commit**

```bash
git add run-backend.ps1
git commit -m "Branch run-backend.ps1 on GPU/CPU via SetupHelpers, warn when no NVIDIA GPU"
```

---

### Task 7: `setup.ps1` orchestrator

**Files:**
- Create: `setup.ps1`

**Interfaces:**
- Consumes: everything produced by Tasks 1-5 (`Test-DockerReady`, `Test-NvidiaGpu`, `Get-EnvApiKey`, `Set-EnvApiKey`, `Get-DockerImageHash`, `Test-NeedsRebuild`, `Set-ImageHashMarker`, `New-DesktopShortcut`, `Show-ApiKeyPrompt`).
- Produces: nothing consumed by later tasks except `setup.bat` (Task 8), which just invokes this file by path.

- [ ] **Step 1: Write the implementation**

Create `setup.ps1`:

```powershell
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
```

- [ ] **Step 2: Manually verify a fresh-install run (real machine)**

Temporarily rename `.env` and delete the hash marker to simulate a first-time machine:

```powershell
Rename-Item .env .env.bak -ErrorAction SilentlyContinue
Remove-Item .docker-image-hash -ErrorAction SilentlyContinue
.\setup.ps1
```

Expected: steps `[1/6]` through `[3/6]` print `OK`, the API key dialog from Task 5 appears (enter a real key or a throwaway `sk-test` if you only want to check the flow, not actually build), step `[4/6]` starts a Docker build, step `[5/6]` reports a new shortcut was created (check the Desktop), step `[6/6]` opens the browser to the raw userscript URL, and the final summary prints.

- [ ] **Step 3: Manually verify idempotency (re-run without changes)**

```powershell
.\setup.ps1
```

Expected: `[3/6]` reports "Da co API key" (no dialog shown), `[4/6]` reports "bo qua build" (no rebuild), `[5/6]` reports "Shortcut da co san" — confirms re-running does nothing destructive or redundant.

- [ ] **Step 4: Restore your real `.env` if you renamed it in Step 2**

```powershell
Remove-Item .env -ErrorAction SilentlyContinue
Rename-Item .env.bak .env -ErrorAction SilentlyContinue
```

- [ ] **Step 5: Commit**

```bash
git add setup.ps1
git commit -m "Add setup.ps1 orchestrator for first-time install and updates"
```

---

### Task 8: `setup.bat` entry point

**Files:**
- Create: `setup.bat`

**Interfaces:**
- Consumes: `setup.ps1` (Task 7), by relative path only.

- [ ] **Step 1: Write the implementation**

Create `setup.bat`:

```bat
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
```

- [ ] **Step 2: Manually verify**

Double-click `setup.bat` in Windows Explorer (or run `.\setup.bat` from `cmd.exe`).
Expected: a console window opens, runs the same flow verified in Task 7, and stays open (`pause`) after finishing so any error message is readable instead of the window closing immediately.

- [ ] **Step 3: Commit**

```bash
git add setup.bat
git commit -m "Add setup.bat double-click entry point"
```

---

### Task 9: Userscript auto-update metadata

**Files:**
- Modify: `manga-overlay-translator.user.js:1-16` (header block)
- Modify: `manga-overlay-translator.user.js` (changelog comment block, immediately before line 244 `(function () {` — see Step 1)
- Test: `manga-overlay-translator.Header.Tests.ps1` (repo root)

**Interfaces:** none — this task only adds metadata comments, no functions.

- [ ] **Step 1: Confirm the anchor line before editing**

Run: `Select-String -Path manga-overlay-translator.user.js -Pattern "^\(function \(\) \{"`
Expected: one match at line 244. If the line number differs (file has changed since this plan was written), use whatever line number this command reports as the insertion point in Step 3 instead of 244.

- [ ] **Step 2: Write the failing test**

Create `manga-overlay-translator.Header.Tests.ps1` at the repo root:

```powershell
BeforeAll {
    $script:content = Get-Content (Join-Path $PSScriptRoot "manga-overlay-translator.user.js") -Raw
}

Describe "Userscript header metadata" {
    It "declares @updateURL pointing to the GitHub raw file" {
        $script:content | Should -Match [regex]::Escape("@updateURL    https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/manga-overlay-translator.user.js")
    }

    It "declares @downloadURL pointing to the GitHub raw file" {
        $script:content | Should -Match [regex]::Escape("@downloadURL  https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/manga-overlay-translator.user.js")
    }

    It "bumps the version to 0.40" {
        $script:content | Should -Match [regex]::Escape("@version      0.40")
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `Invoke-Pester -Path manga-overlay-translator.Header.Tests.ps1 -Output Detailed`
Expected: FAIL — current header has `@version 0.39` and no `@updateURL`/`@downloadURL` lines.

- [ ] **Step 4: Edit the header block**

Replace lines 1-16 of `manga-overlay-translator.user.js` (currently):

```
// ==UserScript==
// @name         Manga Overlay Translator (local)
// @namespace    local
// @version      0.39
// @match        *://*/*
// @match        http://localhost/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @run-at       document-idle
// ==/UserScript==
```

with:

```
// ==UserScript==
// @name         Manga Overlay Translator (local)
// @namespace    local
// @version      0.40
// @match        *://*/*
// @match        http://localhost/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/manga-overlay-translator.user.js
// @downloadURL  https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/manga-overlay-translator.user.js
// ==/UserScript==
```

- [ ] **Step 5: Append a changelog line**

Immediately before the anchor line found in Step 1 (`(function () {`), insert this comment line:

```
// v0.40: them @updateURL/@downloadURL de Tampermonkey tu bao ban cap nhat moi.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `Invoke-Pester -Path manga-overlay-translator.Header.Tests.ps1 -Output Detailed`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add manga-overlay-translator.user.js manga-overlay-translator.Header.Tests.ps1
git commit -m "Add @updateURL/@downloadURL so Tampermonkey auto-detects updates"
```

---

### Task 10: `INSTALL.md` guide + README pointer

**Files:**
- Create: `INSTALL.md`
- Modify: `README.md` (replace the "Chạy backend" section)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Write `INSTALL.md`**

Create `INSTALL.md`:

```markdown
# Cài đặt Manga Overlay Translator

Hướng dẫn này dành cho người dùng cuối — không cần biết lập trình. Toàn bộ chạy trên máy của chính bạn, không có server chung.

## Cần chuẩn bị trước (làm 1 lần)

1. **Tampermonkey** — cài extension này vào Chrome/Edge/Cốc Cốc: mở Web Store của trình duyệt bạn đang dùng, tìm "Tampermonkey", bấm "Add to Chrome" (hoặc "Thêm vào trình duyệt").
2. **Docker Desktop** — tải và cài từ trang chủ: https://www.docker.com/products/docker-desktop/ — cài xong nhớ **mở Docker Desktop lên và đợi nó chạy xong** (biểu tượng cá voi ở khay hệ thống hết xoay là xong) trước khi qua bước tiếp theo. Máy bạn cần có GPU NVIDIA để dịch nhanh (không bắt buộc — không có vẫn chạy được, chỉ chậm hơn nhiều).
3. **API key OpenAI** — vào https://platform.openai.com/, đăng ký tài khoản, thêm phương thức thanh toán, tạo 1 API key mới (dạng `sk-...`). Đây là chi phí bạn tự trả cho lượt dịch của mình, không dùng chung với ai khác.

## Cài đặt

1. Vào trang GitHub của dự án, bấm nút xanh **"Code" → "Download ZIP"**, giải nén ra 1 thư mục bất kỳ.
2. Trong thư mục vừa giải nén, **bấm đúp file `setup.bat`**.
3. Một cửa sổ đen (console) hiện ra và tự chạy từng bước:
   - Nếu báo chưa có Docker: làm theo hướng dẫn ở bước "Cần chuẩn bị trước" rồi bấm đúp lại `setup.bat`.
   - Một hộp thoại nhỏ hiện ra xin API key — dán key `sk-...` của bạn vào, bấm OK.
   - Chương trình tự tải và dựng backend (**lần đầu có thể mất 10-30 phút**, tuỳ mạng — cứ để cửa sổ chạy, đừng tắt).
   - Trình duyệt tự mở 1 tab cài đặt userscript — bấm nút **"Install"** trong tab đó.
4. Xong! Sẽ có 1 shortcut tên **"Bat Manga Translator"** xuất hiện ngoài Desktop.

## Dùng hàng ngày

1. Bấm đúp shortcut **"Bat Manga Translator"** ngoài Desktop (chỉ cần làm khi backend chưa chạy — cửa sổ đen hiện ra và ở nguyên đó, đừng tắt trong lúc dùng).
2. Vào trang truyện bất kỳ, cuộn tới ảnh cần dịch.
3. Bấm `Alt+D` (hoặc bấm icon Tampermonkey trên thanh công cụ → "Dịch trang này").
4. Bấm `Alt+T` để so sánh nhanh bản gốc/bản dịch.

## Khi có bản cập nhật

- **Userscript**: Tampermonkey tự phát hiện, chỉ cần bấm "Update" khi nó báo.
- **Backend**: tải lại code mới nhất (Download ZIP đè lên thư mục cũ) → bấm đúp `setup.bat` lại.

## Gặp lỗi?

- **"Khong phat hien GPU NVIDIA"**: không sao, vẫn dịch được, chỉ chậm hơn (có thể 1-2 phút/ảnh thay vì vài giây).
- **`docker build` báo lỗi giữa chừng**: thường do mất mạng — kiểm tra mạng rồi bấm đúp lại `setup.bat` (không mất tiến độ đã tải, Docker tự tiếp tục).
- **Dịch báo lỗi "Backend chưa bật"**: mở lại shortcut "Bat Manga Translator", đợi vài giây rồi thử lại.
- Các giới hạn/vấn đề khác đã biết: xem mục "Giới hạn đã biết" trong `docs.md`.
```

- [ ] **Step 2: Replace the "Chạy backend" section in `README.md`**

Find this section in `README.md`:

```markdown
## Chạy backend

1. Copy `.env.example` → `.env`, điền `OPENAI_API_KEY`
2. Build image đã vá (chỉ cần 1 lần, hoặc khi cần rebuild):
   ```powershell
   docker build -t manga-translator-patched:local .
   ```
3. Chạy: `.\run-backend.ps1`
4. Kiểm tra: `http://127.0.0.1:5003/docs`
```

Replace it with:

```markdown
## Cài đặt & chạy

**Người dùng cuối:** xem hướng dẫn từng bước tại [`INSTALL.md`](INSTALL.md) — bấm đúp `setup.bat` là đủ.

**Chạy thủ công (cho dev, không qua `setup.bat`):**

1. Copy `.env.example` → `.env`, điền `OPENAI_API_KEY`
2. Build image đã vá (chỉ cần 1 lần, hoặc khi cần rebuild):
   ```powershell
   docker build -t manga-translator-patched:local .
   ```
3. Chạy: `.\run-backend.ps1`
4. Kiểm tra: `http://127.0.0.1:5003/docs`
```

- [ ] **Step 3: Commit**

```bash
git add INSTALL.md README.md
git commit -m "Add INSTALL.md end-user guide, point README to it"
```

---

## Final integration check (after all 10 tasks)

- [ ] Run the full test suite once: `Invoke-Pester -Path . -Output Detailed` from the `manga/` directory — expect every `Describe` block across `lib/*.Tests.ps1` and `manga-overlay-translator.Header.Tests.ps1` to pass.
- [ ] Push everything: `git push`
