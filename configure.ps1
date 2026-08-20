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
Write-Warn 'Đang dừng backend để cấu hình mới có hiệu lực...'
Stop-Backend -ContainerName 'manga_translator'
Write-Warn 'Nếu đang mở cửa sổ "Bật Manga Translator", cửa sổ đó sẽ tự kết thúc.'
Write-Ok 'Xong. Bấm shortcut "Bật Manga Translator" để chạy lại với cấu hình mới.'
Read-Host 'Enter để đóng'