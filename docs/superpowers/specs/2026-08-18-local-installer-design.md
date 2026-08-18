# Thiết kế: Installer hoàn chỉnh cho người dùng chạy local

Ngày: 2026-08-18
Trạng thái: đã chốt thiết kế, chưa triển khai

## 1. Bối cảnh và mục tiêu

Sản phẩm hiện tại chỉ cài được bằng cách clone repo rồi gõ lệnh: sửa `.env` bằng
tay, `docker build`, chạy `run-backend.ps1`, rồi tự vào `chrome://extensions`
bấm Load unpacked. Đó là quy trình của người phát triển, không phải của người dùng.

Mục tiêu: người dùng tải **một file duy nhất**, bấm đúp, và sau đó có một sản
phẩm chạy được — không nhìn thấy mã nguồn, không gõ lệnh, không tự sửa file cấu hình.

### 1.1 Quan hệ với installer cũ đang dừng

Đã có một installer cũ ở nhánh `worktree-feature+setup-installer` (10 nhiệm vụ
xong, 37 test Pester pass) nhưng **thiết kế của nó gắn với userscript**: bước 6
mở trang cài Tampermonkey, và nó chỉ hỏi mỗi `OPENAI_API_KEY`. Từ 2026-07-22
frontend chính đã là extension MV3, nên luồng đó không dùng lại được.

Quyết định: **mở nhánh mới từ `main`**, copy lại bốn module còn đúng
(`EnvFile`, `ImageHash`, `Shortcut`, `SetupHelpers`), **không xoá** nhánh cũ.

## 2. Phạm vi

### Trong phạm vi

- Bootstrapper một file, kiêm luôn cơ chế cập nhật.
- Wizard cài đặt idempotent, 8 bước.
- Hộp thoại cấu hình khoá API / model, dùng lại được sau khi cài.
- Launcher có cửa sổ trạng thái, chờ backend thật sự sẵn sàng.
- Ba shortcut: Bật / Cài đặt / Cập nhật. Thêm `uninstall.ps1` tối giản.
- Tự kiểm tra đầu-cuối sau khi cài (dịch thật một ảnh).
- Hướng dẫn nạp extension có trợ giúp.
- Làm cứng `/fetch-image` (retry + ép IPv4) — xem mục 10.4.

### Ngoài phạm vi (cắt có chủ đích)

- Tự cài driver GPU/CUDA. Chỉ dò và cảnh báo.
- macOS/Linux. Cả dự án dựng trên Windows + Docker Desktop + PowerShell.
- Chứng chỉ ký code. Cảnh báo SmartScreen vẫn còn, được ghi rõ trong hướng dẫn.
- Nhét sẵn image 16.4 GB vào gói cài.
- Tự cập nhật ngầm. Chỉ có shortcut bấm tay.
- Chạy nhiều người dùng / chạy như Windows service.

## 3. Dữ kiện đo được (nền của thiết kế)

Tất cả đo trên máy đích ngày 2026-08-18, không phải phỏng đoán:

| Dữ kiện | Giá trị | Ảnh hưởng tới thiết kế |
|---|---|---|
| Console UTF-8 | `chcp 65001` hoạt động, chữ có dấu và `✓ → ⚠` hiện đúng | Dùng tiếng Việt **có dấu**, bỏ lối viết không dấu của script cũ |
| winget | có sẵn, v1.29.280 | Cài Docker Desktop tự động được, không chỉ mở trang tải |
| Docker Desktop | `C:\Program Files\Docker\Docker\Docker Desktop.exe` | Dò và tự khởi động được |
| Browser | Chrome, Edge, **Cốc Cốc** (`CocCoc\Browser\Application\browser.exe`) đều dò được qua registry App Paths | `chrome://extensions` phải mở bằng cách gọi thẳng file .exe kèm URL |
| Image | 16.4 GB; ổ C: lúc đo còn 16.1 GB trống | Kiểm tra dung lượng là bắt buộc, không phải trang trí |
| `curl.exe` | có sẵn trong `C:\Windows\system32`, 8.21.0 | Dùng nó gọi multipart; `Invoke-RestMethod -Form` chỉ có từ PS 6+, máy đích chạy 5.1 |
| Kho git | 62 file được theo dõi | Gói ZIP nhỏ, tải nhanh |
| `--load-extension` | Chrome bỏ từ bản 137, các cách lách cũng bị chặn nốt ở 142 | Không thể tự nạp extension; phải hướng dẫn |

### 3.1 Một cái bẫy phải thiết kế tránh

`.gitignore` loại `test-image.png` và `*.webp`, nên **chúng không có trong gói
ZIP tải về**. Nặng hơn: `test-page.html` *có* trong git nhưng trỏ tới
`4.webp`/`5.webp`/`6.webp`/`8.webp` — với người dùng mới nó hỏng hoàn toàn.

Hệ quả:

- Bài tự kiểm tra dùng **`fixtures/cjk_vertical_test.png`** (có trong git, tự vẽ
  nên không vướng bản quyền, JP→VI đúng ca dùng thật, số vùng kỳ vọng khoảng 4).
- **Không** dùng `test-page.html` để xác minh extension. Ngoài chuyện thiếu ảnh,
  `file://` còn cần bật riêng "Allow access to file URLs" cho từng extension
  (mặc định tắt) nên sẽ đẻ ra một lỗi khó hiểu ở đúng bước cuối. Thay vào đó xác
  minh bằng **nút "Test kết nối" đã có sẵn trong popup**: nó chứng minh đúng hai
  điều cần, extension đã nạp và gọi được backend.

## 4. Kiến trúc và các entry point

```
install.bat          file duy nhất người dùng tải (wrapper khoảng 5 dòng)
bootstrap.ps1        tải / giải nén / giữ .env, rồi gọi setup.ps1  (kiêm updater)
setup.ps1            wizard 8 bước, idempotent, có -DryRun
start.ps1            launcher "Bật Manga Translator"
configure.ps1        "Cài đặt Manga Translator"
uninstall.ps1        gỡ shortcut + container + image + thư mục cài
lib/
  Ui.ps1             bật UTF-8, Write-Step/Ok/Warn/Err, transcript
  Preflight.ps1      Docker / GPU / đĩa / winget
  EnvFile.ps1        đọc-ghi .env giữ nguyên comment       (mở rộng từ bản cũ)
  DockerImage.ps1    hash + quyết định rebuild             (giữ từ bản cũ)
  BackendControl.ps1 dựng docker args, start/stop/recreate, che secret
  SelfTest.ps1       gọi curl multipart, giải mã stream framed, poll readiness
  BrowserDetect.ps1  dò browser qua App Paths (HKLM+HKCU), mở URL
  Shortcut.ps1       shortcut Desktop + Start Menu         (giữ từ bản cũ)
  ConfigDialog.ps1   hộp thoại WinForms
  ExtensionGuide.ps1 cửa sổ hướng dẫn nạp extension
```

`run-backend.ps1` giữ lại cho việc phát triển nhưng viết lại thành lớp mỏng gọi
`BackendControl.ps1`, để không tồn tại hai bản logic docker-args trôi dạt khỏi
nhau — chính kiểu trùng lặp đó đã đẻ ra lỗi che secret ở mục 8.2.

### 4.1 Luồng người dùng

**Cài lần đầu.** Tải `install.bat` từ GitHub Releases, bấm đúp, SmartScreen cảnh
báo thì bấm *More info → Run anyway*. `install.bat` bật UTF-8, tải
`bootstrap.ps1` từ raw.githubusercontent rồi chạy. `bootstrap.ps1` cài vào
`%LOCALAPPDATA%\MangaTranslator` (không cần quyền Admin), tải ZIP nhánh main,
giải nén, **giữ lại `.env`, `.docker-image-hash`, `result/` nếu đã có**, rồi gọi
`setup.ps1`.

**Dùng hàng ngày.** Bấm shortcut "Bật Manga Translator" → `start.ps1` → console
báo tiến trình → `ĐÃ SẴN SÀNG` → vào trang truyện bấm Alt+D. Đóng cửa sổ là tắt
backend.

**Bảo trì.** "Cài đặt Manga Translator" chạy `configure.ps1`. "Cập nhật Manga
Translator" gọi lại `bootstrap.ps1`.

Điểm mấu chốt: `bootstrap.ps1` **vừa là installer vừa là updater**, và
`setup.ps1` idempotent. Nghĩa là chỉ có **một** đường code cho cài mới, cài lại
và cập nhật, thay vì ba đường phải nuôi riêng.

`install.bat` cố ý giữ tối giản để **không bao giờ phải sửa** — mọi logic nằm
trong repo và được version hoá.

## 5. `setup.ps1` — 8 bước

| # | Bước | Điểm cần lưu ý |
|---|---|---|
| 1 | Tiền kiểm tra | Windows 64-bit, PowerShell 5.1+, **ít nhất 20 GB trống** trên ổ chứa vhdx của WSL2 (không phải ổ chứa thư mục cài). Chặn *trước* khi build |
| 2 | Docker Desktop | Chưa cài thì đề nghị `winget install Docker.DockerDesktop`. Cài xong thường phải reboot (WSL2) nên phải nhận biết và bảo chạy lại. Đã cài mà daemon chưa chạy thì tự mở `Docker Desktop.exe`, poll `docker version` tối đa 3 phút |
| 3 | GPU | `nvidia-smi` cho chế độ GPU, đọc luôn VRAM. Không có thì chế độ CPU kèm cảnh báo rất chậm và hỏi xác nhận. **Không lưu vào `.env`** — dò lại mỗi lần chạy để đổi máy hoặc driver vẫn đúng |
| 4 | Hộp thoại cấu hình | Xem mục 6. Đặt **trước** build để không ai chờ 20 phút rồi mới biết khoá sai |
| 5 | Build image | Hash `Dockerfile` + `patches/*` so với `.docker-image-hash` **và** `docker image inspect`. Chỉ so hash là sai khi image bị xoá tay — lỗi này đã được sửa ở nhánh cũ, giữ nguyên cách sửa đó |
| 6 | Khởi động và tự kiểm tra đầu-cuối | Xem mục 5.1 |
| 7 | Shortcut | Xem mục 5.2 |
| 8 | Nạp extension | Xem mục 5.3 |

### 5.1 Bước 6 — readiness và self-test là **cùng một việc**

Cổng 5003 trả 200 vài giây **trước khi** executor ở 5004 sẵn sàng, nên ping `/`
sẽ báo "ready" quá sớm. Cách đúng là **thử lại chính lệnh dịch** và coi frame
code-2 (`"Translation service is starting up…"`) là chưa sẵn sàng. Vậy không cần
hàm ping riêng: bài self-test **chính là** phép thử readiness, lặp tới khi thành công.

1. Dịch `fixtures/cjk_vertical_test.png` với `translator:"none"` để chứng minh
   detect + OCR + GPU chạy được, **không tốn tiền GPT** (`none` vẫn trả về đủ
   toạ độ và OCR).
2. Rồi một lượt với `chatgpt` thật để chứng minh khoá API, 6 patches và toàn bộ
   pipeline. In ra "Đã dịch được N vùng".

Đây cũng đúng là lúc model AI được tải lần đầu, nên gộp vào đây là đúng chỗ:
người dùng thấy tiến trình thay vì bị treo vô cớ ở trang truyện đầu tiên.

### 5.2 Bước 7 — shortcut đặt ở đâu

Desktop chỉ nhận **một** shortcut duy nhất là "Bật Manga Translator", để không
rác màn hình — đó là thứ người dùng bấm hằng ngày, ba cái còn lại thì hoạ hoằn.

Thư mục Start Menu `Manga Translator` chứa đủ bốn mục: **Bật**, **Cài đặt**,
**Cập nhật**, **Gỡ cài đặt**. Đây cũng là lời giải cho câu hỏi `uninstall.ps1`
được gọi từ đâu — nó không có shortcut Desktop, chỉ nằm trong Start Menu, đúng
chỗ người dùng Windows quen tìm.

Tất cả đều idempotent: đã có thì bỏ qua, không tạo trùng.

### 5.3 Bước 8 — hướng dẫn nạp extension

Copy đường dẫn `extension\` vào clipboard, mở Explorer trỏ vào đó, mở
`chrome://extensions` bằng browser dò được (nhiều browser thì cho chọn), rồi
hiện cửa sổ 4 bước có ảnh minh hoạ:

1. Bật Developer mode
2. Bấm Load unpacked
3. Chọn thư mục (đường dẫn đã nằm sẵn trong clipboard)
4. Mở popup, bấm "Test kết nối", thấy OK là xong

## 6. Hộp thoại cấu hình và `.env`

Dùng chung cho `setup.ps1` và `configure.ps1`, đọc `.env` hiện có làm giá trị
mặc định nên chạy lại không mất gì.

- **Khoá OpenAI**: che bằng dấu tròn kèm nút "Hiện"; kiểm tiền tố `sk-`; nút
  **"Kiểm tra khoá"** gọi thật `GET {base}/v1/models`, phân biệt rõ 401 (khoá
  sai), 200 (được) và lỗi mạng.
- **Model**: `gpt-4o` (khuyến nghị), `gpt-4o-mini`, hoặc ô nhập tay. Nhãn lấy
  **nguyên văn** phần giải thích giá và chất lượng đã có trong `.env.example`,
  không viết lại.
- **Mục "Nâng cao"** (gập lại): `OPENAI_API_BASE`, `GEMINI_API_KEY`,
  `GEMINI_MODEL`, `DEEPL_AUTH_KEY`, kèm ghi chú thật thà rằng Gemini và DeepL
  chưa từng được kiểm chứng thực tế.

`EnvFile.ps1` hiện chỉ đọc-ghi đúng `OPENAI_API_KEY`; tổng quát hoá thành
`Read-EnvFile` và `Set-EnvValue -Key -Value` **giữ nguyên comment và thứ tự
dòng** — quan trọng, vì `.env.example` chứa nhiều ghi chú có giá trị mà ghi đè
thô sẽ xoá sạch.

`configure.ps1` sau khi ghi `.env` phải **tạo lại container** chứ không
`docker restart`: `OPENAI_MODEL` chỉ được nạp lúc tạo container, nên `restart`
sẽ âm thầm giữ model cũ.

## 7. Launcher (`start.ps1`)

Cửa sổ console, không phải WinForms — đây là nơi cần hiện log dài và debug được.
Nó kiểm tra Docker đã chạy chưa, tự mở Docker Desktop nếu chưa, tạo container,
rồi **poll readiness bằng chính phép dịch thật** như mục 5.1, hiện
`ĐANG KHỞI ĐỘNG…` rồi `ĐÃ SẴN SÀNG`, và nhắc "vào trang truyện bấm Alt+D". Đóng
cửa sổ thì dừng container.

## 8. Xử lý lỗi

Nguyên tắc nền: **tính idempotent chính là cơ chế phục hồi.** Không có bước
rollback nào; mọi thất bại kết thúc bằng "sửa nguyên nhân rồi chạy lại", và vì
`setup.ps1` bỏ qua các bước đã xong nên chạy lại rẻ.

Mọi lỗi phải trả lời đủ ba câu bằng tiếng Việt, **không bao giờ lộ stack trace
PowerShell**: hỏng ở đâu, nhiều khả năng vì sao, giờ làm gì.

### 8.1 Bảng lỗi

| Hỏng ở | Thông điệp và lối thoát |
|---|---|
| Đĩa dưới 20 GB | Nói rõ cần bao nhiêu, và chỗ tốn là file vhdx của WSL2 trên C:, không phải thư mục cài |
| winget cài Docker xong | Phát hiện trạng thái "cần khởi động lại", bảo reboot rồi bấm lại `install.bat` |
| Docker daemon không lên sau 3 phút | Trỏ sang cửa sổ Docker Desktop, nó có thông báo lỗi riêng tốt hơn ta đoán hộ |
| Khoá sai | Bắt ngay trong hộp thoại bằng lệnh gọi API thật, trước khi build |
| Build hỏng | In 10-20 dòng cuối của log build, không đổ cả nghìn dòng |
| Self-test hỏng | Phân biệt ba ca: container đã thoát (kèm `docker logs` cuối), GPU hoặc driver lỗi (gợi ý chuyển CPU), khoá bị từ chối lúc dịch thật |

### 8.2 Che secret theo mẫu tên

`run-backend.ps1` dòng 84 hiện chỉ che `OPENAI_API_KEY`, nên từ khi `.env` có
thêm `GEMINI_API_KEY` và `DEEPL_AUTH_KEY`, hai khoá đó **bị in nguyên văn ra
console**. Quy tắc mới: che mọi biến có tên khớp `KEY|TOKEN|AUTH|SECRET`, cài
đặt ở một chỗ duy nhất trong `BackendControl.ps1`.

### 8.3 Nhật ký

Ghi transcript ra `logs/setup-<thời-gian>.log`, đã che secret. Khi người dùng
báo hỏng thì có thứ để đọc, thay vì hỏi vòng vo.

## 9. Chiến lược test

### 9.1 Pester test được (logic thuần)

- Đọc-ghi `.env` giữ nguyên comment và thứ tự dòng
- Quyết định rebuild theo hash **và** kiểm tra image tồn tại thật
- Dựng docker args: GPU so với CPU, biến nào được truyền, che secret đúng mẫu
- Phân tích registry App Paths thành danh sách browser
- Đường dẫn có dấu cách

### 9.2 Bắt buộc người thật kiểm tra trên máy thật

Không tự động hoá được, phải thành checklist trong kế hoạch triển khai:

- Cài Docker qua winget, kể cả nhánh phải reboot
- Lượt build đầy đủ 10-30 phút
- Chạy chế độ GPU **và** chế độ CPU
- Hai hộp thoại WinForms
- Tạo shortcut, cả ba cái
- Luồng Load unpacked trên Chrome, Edge và Cốc Cốc
- **Gemini và DeepL với khoá thật.** Hai engine này merge từ 2026-07-23 nhưng
  chưa từng chạy thật lần nào, và mốc kiểm tra chúng vốn đã được gắn vào đúng
  lúc đóng gói sản phẩm. Gộp vào cùng một lượt, không tách hai.

Nguyên tắc này dự án đã sống theo từ lâu: review và unit test là **cần nhưng
chưa bao giờ đủ** cho phần chạm tới browser hoặc phần cứng.

### 9.3 `-DryRun`

`setup.ps1 -DryRun` chạy hết mọi bước kiểm tra và in ra những gì nó *sẽ* làm,
nhưng không build, không tạo shortcut, không ghi `.env`. Vừa rút vòng lặp thử từ
30 phút xuống vài giây, vừa là thứ Pester test được.

## 10. Quyết định thiết kế và đánh đổi

### 10.1 Console cho luồng chính, WinForms chỉ cho nhập liệu

Console làm tốt việc hiện log dài (build 10-30 phút, tải model) và debug được;
GUI làm tốt việc nhập liệu (che khoá, kiểm tra tại chỗ). Dùng đúng công cụ cho
từng phần thay vì ép một thứ làm cả hai. Đã cân nhắc rồi loại: thuần console
(nhập khoá API dài bằng `Read-Host` rất tệ) và wizard WPF nhiều trang (gấp 3-4
lần code, gần như không test được, mà vẫn phải mở console riêng cho log build).

### 10.2 Hướng dẫn nạp extension thay vì tự động hoá

`--load-extension` đã bị Chrome bỏ. Hai cách còn lại đều tệ hơn. Registry policy
`ExtensionSettings` cần quyền Admin, cần tự ký `.crx` và tự host XML cập nhật,
người dùng không tự tắt được extension, và dễ bị phần mềm bảo mật coi là đáng
ngờ. Chrome Web Store thì sạch cho người dùng nhưng cần tài khoản trả phí, mỗi
lần sửa phải chờ duyệt, và mất khả năng sửa `content.js` tại chỗ để thử nhanh.

### 10.3 Cài vào `%LOCALAPPDATA%`

Không cần quyền Admin. Đổi lại là mỗi tài khoản Windows cài riêng, chấp nhận
được vì sản phẩm vốn là đơn người dùng, chạy cục bộ.

### 10.4 Đưa bản làm cứng `/fetch-image` vào phạm vi

Ngày 2026-08-18 đã đo và xác định: `/fetch-image` trả 502 khoảng 4% khi bật
Cloudflare WARP. WARP bật cho 5/8 thành công, 3/8 hỏng ở đúng 21.0 giây, connect
mất 2.5-10 giây; WARP tắt cho 10/10 thành công, connect 0.65-0.70 giây. Máy
người phát triển chỉ cần tắt WARP là hết, nhưng **người dùng cuối ở Việt Nam rất
có thể phải dùng VPN để vào được nguồn truyện**, tức là họ sẽ gặp đúng lỗi này.
Thêm retry có backoff và ép IPv4 trong handler. Việc này cần một lượt rebuild
image, mà lượt đó dù sao cũng phải chạy trong lúc kiểm tra installer.

Ghi chú cho người triển khai: thông báo lỗi mà handler in ra hiện là
`ConnectError: [Errno 101] Network is unreachable`, và đó là **thông tin gây
hiểu sai**. Nó đến từ nhánh IPv6 (CDN có bản ghi AAAA, container không có route
IPv6 nên nhánh này hỏng tức thì trong 0.00 giây), trong khi lỗi thật khoảng 21
giây nằm ở nhánh IPv4. Ép IPv4 sẽ dọn luôn thông báo sai này.

### 10.5 Tiếng Việt có dấu

Script cũ viết không dấu vì lo console làm hỏng chữ. Đã đo: `chcp 65001` cộng
`[Console]::OutputEncoding = UTF8` cho ra chữ có dấu và cả `✓ → ⚠` đúng. Sản
phẩm giao cho người dùng mà viết không dấu thì trông thiếu chuyên nghiệp, nên
dùng tiếng Việt đầy đủ. Nếu gặp conhost cũ hỏng thì mới lùi về không dấu.

## 11. Rủi ro đã biết

- **SmartScreen** sẽ cảnh báo `install.bat`. Không tránh được nếu không mua
  chứng chỉ ký. Đây là chỗ người dùng dễ bỏ cuộc nhất, nên hướng dẫn tải phải có
  ảnh chụp đúng bước "More info → Run anyway".
- **Lượt build đầu 10-30 phút** kèm 16.4 GB. Không rút ngắn được. Phải nói
  trước, kèm tiến trình, chứ không để người dùng tưởng máy treo.
- **Chế độ CPU chậm tới mức khó dùng.** Vẫn cho chạy nhưng phải cảnh báo thẳng
  và bắt xác nhận.
- **Gemini và DeepL chưa từng chạy thật.** Nếu lượt kiểm tra thủ công phát hiện
  chúng hỏng, phải quyết định: sửa, hay gỡ khỏi popup trước khi phát hành.
