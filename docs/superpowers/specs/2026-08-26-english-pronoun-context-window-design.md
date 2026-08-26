# Cửa sổ ngữ cảnh thoại cho nguồn tiếng Anh — thiết kế

**Ngày:** 2026-08-26
**Trạng thái:** chờ duyệt, chưa triển khai
**Liên quan:** thay thế một phần cho tính năng đã gỡ ngày 2026-08-22 (`7725ebc`)

---

## 1. Vấn đề

Cùng một nhân vật được xưng hô khác nhau giữa các trang. Đo trên phiên đọc thật
(2026-08-26, webtoon *Erkin the Pharmacist*): `cậu` 24 dòng, `cô` 12, `bạn` 7,
`ông` 6, thêm `anh`, `mày`, `thầy`. Bằng chứng trực tiếp — **cùng một câu**, dịch
hai lần, ra hai kết quả:

```
BẠN ĐÃ KHÔNG BẢO QUẢN CÁC LOẠI THẢO DƯỢC ĐÚNG CÁCH...
CẬU KHÔNG BẢO QUẢN THẢO DƯỢC ĐÚNG CÁCH...
```

Và `MR. JENKINS` thành `THẦY JENKINS` ở trang này, `Ông Jenkins` ở trang khác.

### 1.1 Vì sao thêm chỉ dẫn vào prompt không sửa được

`gpt_config-vi.yaml` **đã có** quy tắc 5: *"within one stable relationship state,
reuse the same pair every time; never randomly alternate"*. Nó vẫn loạn, vì quy
tắc đó **bất khả thi theo cấu trúc**: mỗi trang là một lời gọi API độc lập, model
không có cách nào biết trang trước đã dùng cặp nào. Đây không phải vấn đề diễn
đạt prompt, mà là thiếu trạng thái xuyên lượt gọi.

### 1.2 Vì sao bản trước thất bại

Commit `7725ebc` gỡ bỏ cơ chế cũ vì ba lý do đo được:

1. Hồ sơ nhân vật được dựng từ trang bìa/credits/thông báo bản quyền → sinh cặp
   xưng hô sai.
2. Cửa sổ hội thoại đầy banner/SFX thay vì thoại thật.
3. Phồng system prompt 27–32% ở **mọi** lượt dịch.

Thiết kế này phải chứng minh nó không lặp lại cả ba.

---

## 2. Bằng chứng thực nghiệm

Chạy trên **chuỗi trang thật, nguyên si** (gồm cả 3 trang `HUFF`, prologue nhân
vật khác, credits, trang tiêu đề), dùng đúng `chat_system_template` của dự án.
Ba lần chạy mỗi điều kiện. Thước đo là **số lần đổi đại từ giữa các trang liên
tiếp cho cùng một người nghe** — không phải "số loại đại từ", vì thước đo đó
không phân biệt được nhất-quán-đúng với nhất-quán-sai.

| Điều kiện | Đại từ chốt mỗi lần | Số lần đổi (TB) | Tái hiện |
|---|---|---|---|
| A. Không ngữ cảnh (hiện tại) | bạn, bạn, bạn | 5.3 | ổn định |
| B. Cửa sổ **không lọc** | ông, **cậu**, ông | 2.0 | **không tái hiện** |
| C. Cửa sổ **có lọc** | ông, ông, ông | **1.0** | **y hệt cả 3 lần** |

**Thích ứng vẫn giữ được.** Sang cảnh Annetta (bạn bè ngang hàng) điều kiện C đổi
đúng sang `cậu` ở cả 2 lần chạy, chỉ rò một lần `ông`. Cửa sổ *thiên vị* chứ
không *ép cứng* — đúng yêu cầu đã chốt.

**Trộn ngữ cảnh giữa các truyện là tai hoạ âm thầm.** Thí nghiệm tiêm ngữ cảnh từ
một truyện cung đình khiến toàn bộ cảnh tiệm thuốc hiện đại bị dịch bằng giọng
`ta-ngươi`, trong khi **mọi thước đo nhất quán tự động đều báo đẹp**. Đây là căn
cứ bắt buộc cho quyết định phạm vi ở mục 3.

**Chi phí:** +12% token prompt (38.930 → 43.682 cho 20 trang) — so với 27–32% của
bản cũ.

**Một kết quả đã bị bác bỏ:** lần chạy đầu tiên, điều kiện C chốt vào `ngài` và
tôi suýt kết luận bộ lọc chọn đại từ tệ. Lặp lại 3 lần cho thấy đó là nhiễu.
Không kết luận gì từ n=1.

---

## 3. Phạm vi

**Chỉ áp dụng khi nguồn là tiếng Anh.**

Lý do không chỉ là tiết kiệm: tiếng Anh chỉ có một chữ `you` nên model buộc phải
đoán ngôi xưng — đúng chỗ cửa sổ giúp được. Tiếng Nhật/Hàn **mã hoá sẵn mức lịch
sự trong câu gốc** (です/ます vs thể thường, 요/습니다 vs 반말), model đã có tín
hiệu mà tiếng Anh không có. Toàn bộ số đo ở mục 2 là tiếng Anh; áp cho CJK là suy
diễn không có bằng chứng — đúng kiểu sai lầm đã làm hỏng bản trước.

Truyện CJK đi đường hiện tại, không đổi gì, không trả thêm token.

**Cách nhận biết:** client không gửi ngôn ngữ nguồn (backend tự nhận diện), nên
dùng chính `_srcNonLatin` đã có sẵn ở `content.js:1510`. Một vùng chỉ được nạp
vào cửa sổ khi `src` của nó là Latin; cửa sổ chỉ được gửi kèm khi trang chủ yếu
là chữ Latin.

---

## 4. Thiết kế

### 4.1 Ngữ cảnh sống ở client, theo từng tab

`content.js` giữ cửa sổ trong bộ nhớ tab, gửi kèm mỗi request dịch.

- 10 tab của người dùng **không thể** trộn vào nhau (mục 2 chứng minh đây là
  bắt buộc, không phải sở thích).
- Backend **không giữ state nào** → không thể "brick" cả truyện như bản cũ;
  hỏng thì cùng lắm mất ngữ cảnh, chất lượng tụt về mức hiện tại.
- Mất khi reload trang. Chấp nhận: cửa sổ tự dựng lại sau vài trang.

### 4.2 Nội dung cửa sổ

Tối đa **8 cặp `src -> dst` gần nhất**, theo thứ tự đọc.

Bộ lọc, áp **theo từng dòng** (không theo trang — trang 12 trong log là thoại
thật nhưng có một vùng OCR kém; lọc theo trang sẽ vứt nhầm cả trang):

| Loại bỏ khi | Lý do |
|---|---|
| Khớp danh sách SFX (`HUFF`, `DING`, `ARGHH`…) | không phải thoại |
| Khớp mẫu credits (`tappytoon`, `STUDIO`, `Art&Story`…) | rác đầu/cuối chương |
| Dưới 3 từ | nhãn, biển hiệu, tiếng động |
| `dst == src` | GPT trả nguyên văn → SFX hoặc tên riêng |
| `src` không phải Latin | ngoài phạm vi (mục 3) |

Bộ lọc này **không cần `prob`** — quan trọng, vì `normalizeResponse` trong
`background.js` hiện không gửi `prob` về client. Không phải sửa backend để lấy
thêm dữ liệu.

### 4.3 Đường truyền

Cửa sổ đi kèm request, được đặt vào `prev_context` của translator — cơ chế
upstream **đã có sẵn** (`chatgpt.py:660` đọc `self.prev_context`,
`set_prev_context()` ở dòng 85).

**Rủi ro phải kiểm chứng khi triển khai, không được giả định:** `set_prev_context`
đặt state lên *instance*, mà executor dùng chung cho mọi tab. Backend xử lý tuần
tự (đã xác nhận thực nghiệm ở Giai đoạn B) nên về lý là an toàn, **với điều kiện**
việc set diễn ra bên trong chính task đang dịch, không phải lúc phân tích request.
Kế hoạch triển khai phải có một bài test đồng thời nhiều tab chứng minh điều này.

### 4.4 Ngoài phạm vi

**Viết hoa.** *(ĐÃ LÀM 2026-08-26, xem `extension/content-script/text-case.js` — bám theo chữ gốc thay vì ép cứng.)* Vấn đề độc lập, và thí nghiệm cho thấy cửa sổ còn *khuếch đại* nó
(22/24 dòng ALL-CAPS so với 15/24 khi không có cửa sổ). Đây là việc chuẩn hoá xác
định được, phải làm ở client lúc render, không nhờ LLM. Tách thành thiết kế
riêng — kèm cảnh báo: `.capitalize()` ngây thơ sẽ biến `ERKIN` giữa câu thành
`erkin`, mà cả nguồn lẫn đích đều ALL-CAPS nên không thể phân biệt tên riêng bằng
máy.

**Khởi động nguội.** Trang đầu của chương vẫn có thể ra `thầy Jenkins` trước khi
ổn định vào `ông` (thấy 1 lần đổi ở điều kiện C). Chấp nhận ở bản này.

**Lỗ hổng do cache.** Trang trúng cache không gọi GPT nên không đóng góp vào cửa
sổ. Chưa đo được ảnh hưởng; cần theo dõi.

---

## 5. Kiểm thử

| Việc | Cách |
|---|---|
| Bộ lọc | test thuần bằng `node --test`, dữ liệu thật lấy từ log (gồm cả credits/SFX) |
| Cổng tiếng Anh | test thuần: câu CJK không bao giờ vào cửa sổ, trang CJK không gửi cửa sổ |
| Giới hạn 8 mục | test thuần |
| Không tranh chấp giữa các tab | 2+ tab dịch đồng thời, xác nhận cửa sổ không lẫn |
| Hiệu quả thật | chạy lại bộ thí nghiệm mục 2 trên chương mới, 3 lần, so số lần đổi |
| Không hồi quy | truyện CJK phải đi đúng đường cũ, không kèm cửa sổ |

Điều kiện chấp nhận: trên nguồn tiếng Anh, **số lần đổi đại từ giảm rõ so với
hiện tại và tái hiện được qua 3 lần chạy**; truyện CJK không đổi hành vi lẫn chi
phí.

---

## 6. Điều đã biết là chưa biết

- Chưa đo trên chương tiếng Anh thứ hai; toàn bộ số liệu đến từ một truyện.
- Chưa biết cửa sổ hành xử ra sao khi chương rất dài và có nhiều cảnh đổi nhân vật.
- `gpt-4o-mini` là model duy nhất được đo.
