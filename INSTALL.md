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
