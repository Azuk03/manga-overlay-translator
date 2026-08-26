# uninstall.ps1
$root = $PSScriptRoot
foreach ($m in @('Ui', 'Shortcut', 'BackendControl')) { . (Join-Path $root "lib/$m.ps1") }
Initialize-Ui

Write-Step 'Gỡ cài đặt Manga Translator'

# result/ là ảnh debug backend tự ghi ra (input/bboxes/inpainted/final, khoảng
# 37 MB mỗi trang) khi chạy ở chế độ --verbose. Nó không được tính vào con số
# "16 GB" của image nên người dùng không có cách nào biết nó tồn tại - trên máy
# này nó đã âm thầm giữ 4,9 GB. Đo và nói ra trước khi hỏi.
$resultDir = Join-Path $root 'result'
$resultNote = ''
if (Test-Path $resultDir) {
    try {
        $bytes = (Get-ChildItem -LiteralPath $resultDir -Recurse -File -ErrorAction Stop |
                  Measure-Object -Property Length -Sum).Sum
        if ($bytes -gt 0) {
            $resultNote = ", xoá {0:N1} GB ảnh debug trong result/" -f ($bytes / 1GB)
        }
    } catch {
        $resultNote = ', xoá ảnh debug trong result/'
    }
}

$answer = Read-Host "Xoá container và image (khoảng 16 GB)$resultNote, gỡ shortcut? Thư mục cài sẽ được giữ lại. (c/k)"
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

# Ảnh debug tái tạo được (chỉ sinh ra khi chạy --verbose) - không có gì của
# người dùng ở đây. Xoá nội dung, giữ lại thư mục vì container mount vào nó.
if ($resultNote -and (Test-Path $resultDir)) {
    try {
        Get-ChildItem -LiteralPath $resultDir -Force -ErrorAction Stop |
            Remove-Item -Recurse -Force -ErrorAction Stop
        Write-Ok 'Đã dọn result/.'
    } catch {
        Write-Warn "Không dọn được result/: $($_.Exception.Message)"
    }
}

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