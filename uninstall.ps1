# uninstall.ps1
$root = $PSScriptRoot
foreach ($m in @('Ui', 'Shortcut', 'BackendControl')) { . (Join-Path $root "lib/$m.ps1") }
Initialize-Ui

Write-Step 'Gỡ cài đặt Manga Translator'
$answer = Read-Host 'Xoá container và image (khoảng 16 GB), gỡ shortcut? Thư mục cài sẽ được giữ lại. (c/k)'
if ($answer -ne 'c') { exit 0 }

Stop-Backend -ContainerName 'manga_translator'
# docker co the da bi go khoi may (nhat la khi nguoi dung go Docker Desktop truoc
# roi moi chay uninstall) - loi phan giai lenh khong bi 2>$null chan lai.
$imageRemoved = $false
try {
    docker image rm 'manga-translator-patched:local' 2>$null | Out-Null
    $imageRemoved = ($LASTEXITCODE -eq 0)
} catch {
    $imageRemoved = $false
}
Remove-AppShortcuts
if ($imageRemoved) {
    Write-Ok 'Đã gỡ shortcut, container và image.'
} else {
    Write-Ok 'Đã gỡ shortcut và container.'
    Write-Warn 'Không xoá được image (Docker chưa chạy?). Image khoảng 16 GB vẫn còn trên đĩa.'
    Write-Warn 'Bật Docker Desktop rồi chạy: docker image rm manga-translator-patched:local'
}
Write-Warn "Thư mục cài còn lại tại: $root"
Write-Warn 'Xoá nốt bằng tay nếu muốn (không tự xoá được vì script đang chạy trong đó).'
Read-Host 'Enter để đóng'