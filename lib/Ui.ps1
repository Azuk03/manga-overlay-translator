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