# Thiết kế: Đóng gói & phân phối cho người dùng khác (setup.bat)

> Ngày: 2026-07-19. Trạng thái: đã thống nhất với người dùng qua brainstorming, sẵn sàng chuyển sang viết implementation plan.

## 1. Bối cảnh & mục tiêu

Dự án `manga-overlay-translator` (xem `docs.md`/`README.md` để hiểu kiến trúc gốc) hiện chỉ chạy được trên máy người viết ra nó, cấu hình thủ công (copy `.env.example` → `.env`, tự sửa tay, tự chạy `docker build`/`run-backend.ps1`, tự cài userscript vào Tampermonkey).

**Mục tiêu:** cho phép chia sẻ dự án cho một vài người dùng khác (bạn bè/đồng nghiệp), để họ tự cài và chạy trên máy của chính họ, với API key riêng của họ — giảm tối đa số bước thủ công, có giao diện (UI) cho phần nhập liệu nếu khả thi.

**Ngoài phạm vi (không làm):** app/installer đóng gói dạng .exe hay Electron, hỗ trợ macOS/Linux, hỗ trợ GPU AMD/Intel bằng gia tốc phần cứng thật (chỉ có fallback CPU), tự động cài Docker Desktop, chia sẻ chung 1 API key.

## 2. Đối tượng người dùng & giả định

- Không rành kỹ thuật — cần tối thiểu hoá thao tác dòng lệnh/chỉnh file tay.
- Chỉ dùng Windows.
- **Đa số có GPU NVIDIA**, nhưng script phải xử lý an toàn (không sập cứng) cho trường hợp không có — xem mục 5.
- Mỗi người tự có tài khoản + API key OpenAI riêng (không chia sẻ key).
- Đã có Git repo public: `github.com/Azuk03/manga-overlay-translator` (đã hoàn thành, xem mục 8 lịch sử).

## 3. Cấu trúc file thêm vào repo

```
manga/
├── setup.bat          # người dùng bấm đúp file này để cài đặt / cập nhật
├── setup.ps1          # logic thật; setup.bat chỉ gọi PowerShell (ExecutionPolicy Bypass)
├── INSTALL.md          # hướng dẫn từng bước bằng tiếng Việt cho người dùng cuối
└── (giữ nguyên) run-backend.ps1, Dockerfile, .env.example, patches/, fixtures/...
```

Không thêm framework hay dependency ngoài — toàn bộ dùng PowerShell + .NET Windows Forms có sẵn trong Windows (cho hộp thoại nhập API key).

`setup.bat` được dùng lại cho **cả lần cài đầu tiên lẫn các lần cập nhật sau này** (idempotent — xem mục 6).

## 4. Luồng `setup.ps1`

```
1. Kiểm tra `docker version` chạy được (Docker Desktop đã cài + đang bật).
   → Nếu KHÔNG: mở trình duyệt tới trang tải Docker Desktop, in hướng dẫn
     "Cài xong, mở Docker Desktop, đợi nó chạy xong rồi bấm đúp lại setup.bat",
     dừng script tại đây (không làm gì thêm).

2. Kiểm tra `nvidia-smi` chạy được không → xem nhánh mục 5 (KHÔNG chỉ cảnh
   báo — rẽ nhánh thật cấu hình chạy CPU/GPU).

3. Kiểm tra `.env` đã tồn tại + có OPENAI_API_KEY hợp lệ chưa:
   - Nếu chưa: bật hộp thoại Windows Forms (textbox + nút OK) xin dán API
     key. Validate: không rỗng, bắt đầu bằng "sk-". Sai → báo lỗi ngay
     trong hộp thoại, bắt nhập lại, không cho qua bước tiếp.
   - Nếu đã có và hợp lệ: bỏ qua bước này (cho phép chạy lại setup.bat an
     toàn nhiều lần).

4. Kiểm tra có cần rebuild Docker image không (xem mục 6 — hash-based,
   không chỉ "image đã tồn tại chưa"). Nếu cần: `docker build`, in rõ
   "lần đầu có thể mất 10-30 phút, đang tải model AI...".

5. Tạo shortcut Desktop "Bat Manga Translator.lnk" trỏ tới
   `run-backend.ps1` (qua `powershell.exe -File ...`), nếu chưa có sẵn.

6. Mở trình duyệt tới URL raw của userscript trên GitHub
   (raw.githubusercontent.com/.../manga-overlay-translator.user.js) —
   kích hoạt trang cài đặt/cập nhật của Tampermonkey.

7. In tóm tắt kết quả (đã cài xong / đã cập nhật xong) + nhắc "Bấm
   shortcut 'Bat Manga Translator' mỗi khi muốn dùng, rồi vào trang
   truyện bấm Alt+D."
```

Mọi bước đều **idempotent**: chạy lại `setup.bat` nhiều lần (kể cả sau khi lỗi giữa chừng) không phá hỏng gì, chỉ làm lại đúng phần còn thiếu/đã đổi.

## 5. Xử lý GPU NVIDIA vs CPU-only

**Vấn đề kỹ thuật:** `docker run --gpus all` là cơ chế riêng của NVIDIA Container Toolkit. Nếu máy không có GPU NVIDIA (`nvidia-smi` không chạy được), cờ này khiến `docker run` **báo lỗi cứng ngay lập tức** ("could not select device driver"), không tự rơi về CPU. Bản thân image backend cũng chỉ build sẵn cho CUDA, không có bản ROCm (AMD) hay Intel.

**Giải pháp — rẽ nhánh thật trong `run-backend.ps1`/`setup.ps1`:**
- Có `nvidia-smi` → giữ nguyên hành vi cũ: `--gpus all` trong `docker run` + `--use-gpu` trong tham số backend (`server/main.py`).
- Không có `nvidia-smi` → **bỏ hẳn** `--gpus all` và `--use-gpu` khỏi lệnh chạy (chạy CPU-only, chương trình vẫn chạy được, chỉ chậm hơn 10-20 lần theo ghi nhận ở `docs.md` mục 2.5).

**Bắt buộc thông báo rõ cho người dùng** (yêu cầu tường minh của người dùng) ở **cả 2 thời điểm**:
1. Lúc chạy `setup.ps1` lần đầu (nếu rơi vào nhánh CPU).
2. Mỗi lần khởi động backend qua shortcut (`run-backend.ps1`) — vì đây là lúc người dùng thực sự chờ và có thể tưởng máy bị treo do dịch chậm.

Thông báo dạng cảnh báo nổi bật (ví dụ in màu vàng/đỏ trong console): *"Khong phat hien GPU NVIDIA — dang chay che do CPU (cham hon nhieu, moi anh co the mat 1-2 phut thay vi vai giay)."*

## 6. Cập nhật phiên bản sau này

- **Userscript**: hoàn toàn tự động — thêm `@updateURL` và `@downloadURL` vào header `manga-overlay-translator.user.js`, trỏ tới raw URL trên GitHub. Tampermonkey tự kiểm tra định kỳ, báo có bản mới, người dùng chỉ bấm "Update".
- **Backend**: không tự động chạy ngầm (tránh rebuild tốn thời gian/tài nguyên mà người dùng không hay biết). Khi có thay đổi (patch mới, đổi `Dockerfile`...), người dùng: tải code mới (Download ZIP đè lên, hoặc `git pull`) → bấm đúp `setup.bat` lại.

**Cơ chế phát hiện cần rebuild (thay vì chỉ kiểm tra "image đã tồn tại"):** tính hash (SHA-256, ghép nội dung `Dockerfile` + toàn bộ file trong `patches/`), lưu vào 1 file marker cạnh nhau (ví dụ `.docker-image-hash` trong thư mục dự án, **không commit** — thêm vào `.gitignore`). Lần chạy `setup.ps1` sau so sánh hash mới tính được với hash đã lưu:
- Giống nhau → bỏ qua rebuild, chạy thẳng container.
- Khác nhau (hoặc chưa có file marker) → rebuild, rồi ghi lại hash mới sau khi build thành công.

## 7. Xử lý lỗi

| Tình huống | Xử lý / thông báo |
|---|---|
| Docker chưa cài/chưa bật | Mở trang tải Docker Desktop, in hướng dẫn bấm lại `setup.bat` sau khi cài xong, dừng script |
| Không có GPU NVIDIA | Rẽ nhánh CPU-only (mục 5), cảnh báo rõ ràng, **không chặn**, tiếp tục chạy |
| API key rỗng hoặc sai định dạng `sk-...` | Báo lỗi ngay trong hộp thoại nhập liệu, bắt nhập lại, không ghi `.env` cho tới khi hợp lệ |
| `docker build` thất bại (mất mạng giữa chừng...) | In lỗi gốc từ Docker, gợi ý kiểm tra mạng rồi chạy lại `setup.bat` (an toàn — Docker cache layer, không phải build lại từ đầu) |
| API key sai/hết hạn lúc dịch thật (lỗi runtime từ OpenAI) | Không xử lý thêm ở tầng cài đặt — đã có sẵn cơ chế báo lỗi thân thiện trong userscript (xem `docs.md` mục 6.8) |

## 8. Quyết định kiến trúc đã cân nhắc và loại bỏ

**Không chuyển sang Chrome/Edge extension thật (Manifest V3) để bỏ phụ thuộc Tampermonkey.** Về kỹ thuật khả thi (`fetch()` trong background service worker + `host_permissions` khai báo sẵn cũng bypass được CORS/mixed-content y như `GM_xmlhttpRequest`), nhưng bị loại vì đánh đổi không xứng đáng:
- Cần quay lại đúng thứ dự án đã chủ động từ chối từ đầu (build step, `manifest.json`, tách content/background script) — xem `docs.md` mục 2.1.
- Người dùng vẫn phải làm 1 bước thủ công tương đương (Load unpacked ở Developer Mode, kèm banner cảnh báo Chrome nhắc định kỳ) — **không giảm được bước nào** so với Tampermonkey.
- **Mất luôn cơ chế tự cập nhật** tiện lợi hiện có (`@updateURL`) — extension "Load unpacked" phải tự thay file + reload tay mỗi lần có bản mới, tệ hơn hiện tại.

**Không để `setup.ps1` tự tải + cài Docker Desktop im lặng (`--quiet`).** Dù kỹ thuật khả thi, cài đặt phần mềm hệ thống cần quyền admin + có thể cần bật tính năng Windows (WSL2) + đôi khi cần khởi động lại máy — rủi ro cao hơn lợi ích, để người dùng tự cài qua trình cài đặt chuẩn của Docker (vẫn đơn giản: Next-Next-Finish) an toàn hơn.

**Không xây dựng app/installer .exe riêng (Electron/Inno Setup).** Không tương xứng với quy mô "vài người dùng quen biết" — vi phạm tinh thần "không làm thừa" xuyên suốt dự án.

## 9. Danh sách bước người dùng cuối thực hiện (tổng hợp)

**Một lần duy nhất — thủ công, không thể tự động hoá (giới hạn nền tảng, không phải hạn chế kỹ thuật của mình):**
1. Cài Tampermonkey (bấm "Add to Chrome/Edge" từ Web Store).
2. Tự đăng ký tài khoản OpenAI + lấy API key (`sk-...`).
3. Cài Docker Desktop (script tự mở trang tải nếu chưa có, nhưng người dùng tự chạy trình cài đặt).

**Một lần duy nhất — bấm đúp `setup.bat`, còn lại tự động:**
4. Hộp thoại hiện ra, dán API key vào, bấm OK.
5. Chờ `docker build` xong (lần đầu, 10-30 phút tuỳ mạng).
6. Trình duyệt tự mở trang cài userscript vào Tampermonkey — bấm "Install".
7. Shortcut Desktop được tạo sẵn.

**Mỗi lần muốn đọc truyện (hàng ngày):**
8. Bấm đúp shortcut "Bat Manga Translator" để bật backend.
9. Vào trang truyện, bấm `Alt+D` hoặc menu Tampermonkey để dịch.

**Khi có bản cập nhật:**
10. Userscript: Tampermonkey tự báo, bấm "Update" (không cần làm gì thêm).
11. Backend: tải code mới → bấm đúp `setup.bat` lại (tự phát hiện cần rebuild qua hash, mục 6).

## 10. Lịch sử liên quan (đã hoàn thành trước khi viết spec này)

- Repo git đã khởi tạo và push lên `github.com/Azuk03/manga-overlay-translator` (public), dùng SSH key riêng (`~/.ssh/id_ed25519_azuk03`, host alias `github.com-azuk03`) tách biệt với tài khoản GitHub cá nhân khác trên cùng máy.
- Đã loại `*.webp` (ảnh test có bản quyền thật) khỏi repo, thêm vào `.gitignore`.
- Đã copy `spec-manga-overlay-translator.md` (từng nằm ở thư mục cha) vào trong repo, sửa lại các link tham chiếu trong `docs.md`/`README.md`.

## 11. Kiểm thử

Vì không dễ có "máy sạch" thật để test toàn bộ luồng cài đặt, kế hoạch kiểm thử theo từng phần:
- Test độc lập từng bước của `setup.ps1` (mock `docker`/`nvidia-smi` bằng cách đổi PATH tạm thời, hoặc kiểm tra logic rẽ nhánh bằng cách giả lập biến môi trường) — không cần Docker/GPU thật cho phần logic script.
- Test thật trên chính máy hiện tại (đã có Docker + GPU NVIDIA): chạy `setup.bat` từ đầu (xoá `.env`/image tạm để giả lập "máy mới"), xác nhận từng bước theo đúng luồng mục 4.
- Test nhánh CPU-only bằng cách tạm thời đổi tên/ẩn `nvidia-smi` khỏi PATH trong 1 lần chạy thử, xác nhận cảnh báo hiện đúng cả 2 nơi (setup + run-backend).
- Test cơ chế hash rebuild (mục 6): sửa 1 dòng trong `patches/gpt_config-vi.yaml`, chạy lại `setup.bat`, xác nhận có rebuild; chạy lại lần nữa không sửa gì, xác nhận bỏ qua rebuild.
