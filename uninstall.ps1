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
try {
    docker image rm 'manga-translator-patched:local' 2>$null | Out-Null
} catch {
    Write-Warn 'Không gọi được docker (có thể đã gỡ Docker Desktop) — bỏ qua bước xoá image.'
}
Remove-AppShortcuts
Write-Ok 'Đã gỡ shortcut, container và image.'
Write-Warn "Thư mục cài còn lại tại: $root"
Write-Warn 'Xoá nốt bằng tay nếu muốn (không tự xoá được vì script đang chạy trong đó).'
Read-Host 'Enter để đóng'