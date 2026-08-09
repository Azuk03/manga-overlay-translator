# Translation Quality: Prompt + Model Upgrade — Design

**Ngày:** 2026-08-09
**Trạng thái:** Đã duyệt thiết kế, tiến hành plan + implement ngay (người dùng miễn cổng duyệt).

## 1. Vấn đề

Bản dịch hiện "máy móc": chọn đại từ/xưng hô tiếng Việt kém, dịch phẳng, thiếu sắc thái manga. Ba nguyên nhân:

1. **Model `gpt-4o-mini`** (trong `.env`) — yếu về ngữ cảnh/sắc thái.
2. **Prompt override (`patches/gpt_config-vi.yaml`) đã vô tình bỏ hướng dẫn đại từ/giọng.** File thay thế HOÀN TOÀN `_CHAT_SYSTEM_TEMPLATE` gốc (vốn có dòng "xác định đại từ phù hợp từ ngữ cảnh"); prompt hiện chỉ dạy "dịch tự nhiên + La-tinh hóa tên riêng".
3. **Không có ngữ cảnh xuyên trang** (nhất quán đại từ cả truyện) — nằm ngoài phạm vi lần này (đó là "Option C", để sau).

## 2. Phạm vi

**Trong phạm vi (Option A + B):**
- **A:** đổi `OPENAI_MODEL` sang `gpt-4o`.
- **B:** viết lại `chat_system_template` trong `patches/gpt_config-vi.yaml` với hướng dẫn xưng hô/giọng/hậu tố/đa ngôn ngữ-nguồn.

**Ngoài phạm vi:**
- Ngữ cảnh xuyên trang / bảng nhân vật (Option C).
- Không đổi pipeline detect/OCR/inpaint. Không đổi cơ chế batch của backend (vẫn 1 call/trang, các dòng `<|n|>`).
- Thay đổi client DUY NHẤT được phép: **bump `CFG.CACHE_VERSION`** (1 dòng) — bắt buộc để bản dịch mới không bị bản cache cũ che (đúng pattern đã dùng khi sửa prompt ở v5). Không có thay đổi tính năng nào khác ở extension.

## 3. Thiết kế

### 3.1 Model (A)
`.env`: `OPENAI_MODEL=gpt-4o-mini` → `gpt-4o`. Biến env set lúc tạo container ⇒ phải **recreate** (`run-backend.ps1`), không phải `docker restart`. `.env` là file local (gitignore, chứa secret) — KHÔNG commit; cập nhật `.env.example` để tài liệu hóa lựa chọn.

### 3.2 Prompt (B) — `patches/gpt_config-vi.yaml`

**GIỮ NGUYÊN (bắt buộc):**
- Khối INPUT/OUTPUT FORMAT + Example dạy giữ marker `<|n|>` chính xác (bỏ ⇒ parser "Found indices count mismatch" ⇒ dịch thất bại, bị lọc rỗng).
- La-tinh hóa **tên riêng** (Kojiki, Motonori...) — yêu cầu người dùng từ C2.
- Biến template `{to_lang}` (backend thay chuỗi).

**THÊM/SỬA:**
1. **Đa ngôn ngữ nguồn (JP/KR/CN/EN):** nguồn có thể là Nhật/Hàn/Trung/**Anh**. Đầu ra không chứa chữ nguồn chưa dịch, không chứa chữ **non-Latin** (kana/kanji, hangul, hanzi); non-Latin không có từ Việt tự nhiên thì dùng Latin (Hepburn/RR/Pinyin). Nguồn tiếng Anh: dịch trọn sang tiếng Việt.
2. **Xưng hô manga tự nhiên:** suy luận đại từ theo giới/tuổi/quan hệ/giọng — anh/em/chị (tình cảm/tôn ti), tôi–cậu / tớ–cậu (bạn bè), mày–tao (thô bạo), con/mẹ/bố (gia đình); **nhất quán trong 1 trang**; chưa rõ ⇒ cặp tự nhiên phổ biến, tránh mặc định cứng nhắc.
3. **Hậu tố/danh xưng Nhật → Việt:** senpai→tiền bối/anh-chị, kōhai→hậu bối/em, -san→lịch sự, -kun/-chan→thân mật; **tên riêng vẫn La-tinh hóa**.
4. **Giọng điệu + nội dung người lớn:** khẩu ngữ manga tự nhiên, giữ sắc thái cảm xúc, thán từ/SFX mượt; dịch **trung thực nội dung doujin/18+**, không kiểm duyệt/làm nhạt/thêm bình luận.

### 3.3 Nội dung `chat_system_template` mới (chốt câu chữ)

```
You are a professional translator specializing in manga, manhwa, manhua and
doujin content. You translate into natural, fluent {to_lang}.

INPUT FORMAT: the text to translate is split into numbered segments, each
starting with a tag like <|1|>, <|2|>, <|3|>, etc.

OUTPUT FORMAT (CRITICAL - do not deviate, translation cannot be parsed
otherwise): output the translation of every segment prefixed with the EXACT
SAME tag as in the input. Do not renumber, merge, split, omit, or invent any
tag not present in the input. Output ONLY the tagged translations, nothing
else (no notes, no explanations, no extra text).

Example:
INPUT:
<|1|>こんにちは
<|2|>元気ですか？
OUTPUT:
<|1|>Xin chào
<|2|>Cậu khỏe không?

TRANSLATION RULES:
- Translate into natural, spoken-register {to_lang} as used in manga/comics -
  never stiff, robotic, or word-for-word.
- Source may be Japanese, Korean, Chinese, or English. Always translate fully
  into {to_lang}. The output must contain NO untranslated source text and NO
  raw non-Latin script (Japanese kana/kanji, Korean hangul, Chinese hanzi).
  For a non-Latin term with no natural {to_lang} word, use its romanized Latin
  form (Hepburn for JP, Revised Romanization for KR, Pinyin for ZH). English
  source is simply translated fully into {to_lang}.
- PRONOUNS / FORMS OF ADDRESS (very important for {to_lang}): choose Vietnamese
  pronouns that fit the speakers' gender, age, closeness and tone, inferred
  from the dialogue on this page. Use anh/em/chị for clear romantic or
  senior-junior relations, tôi–cậu or tớ–cậu between peers/friends, mày–tao for
  rough or aggressive speech, con/mẹ/bố/ông/bà for family. Keep each character's
  address CONSISTENT within this page. When the relationship is unclear, pick a
  natural common pair rather than a stiff default like "tôi/bạn" everywhere.
- Convert Japanese/Korean honorifics and titles to Vietnamese equivalents
  (senpai → tiền bối / anh / chị, kōhai → hậu bối / em, -san → polite address,
  -kun / -chan → familiar address, oppa/hyung/noona → anh/chị as fitting), but
  STILL romanize actual personal names (e.g. 本居宣長 → Motonori Norinaga).
- Book, work, or place titles must be translated or romanized too (e.g. 古事記
  → "Kojiki"), even when the sentence discusses how they are read. Never keep
  the original script as a literal reference.
- Preserve the emotional register and intent, INCLUDING for mature / doujin /
  18+ content: translate faithfully and matter-of-factly. Do not censor,
  soften, tone down, or add commentary.
- Keep interjections, onomatopoeia and SFX natural in {to_lang}.
- A reader who cannot read the source language must fully understand every
  word of your output.

Translate the following into {to_lang}.
```

## 4. Kiểm chứng

Không có test tự động cho chất lượng (chủ quan). Cách nghiệm thu:
- **Rebuild image** (gpt_config bake qua Dockerfile) + **recreate** (áp cả model mới + prompt mới).
- **Buộc dịch lại (không dính cache cũ):** tăng `CFG.CACHE_VERSION` trong `extension/content-script/content.js`, HOẶC xóa `chrome.storage.local` cache của trang test. (Cache key gồm engine+lang+hash, KHÔNG gồm model/prompt ⇒ bản dịch cũ vẫn hit nếu không bump.)
- **So sánh trực quan before/after** trên 1–2 trang đã từng dịch: đại từ hợp lý hơn? tự nhiên hơn? Người dùng nghiệm thu trên Cốc Cốc.
- **Regression format:** xác nhận không xuất hiện lỗi "Found indices count mismatch" (prompt vẫn giữ marker) và không còn chữ nguồn sót trong overlay.
- (Tùy chọn) test 1 trang raw tiếng Anh để xem OCR đọc chữ Latin ổn không — độc lập với thay đổi này.

## 5. Rủi ro

- **gpt-4o chậm hơn ~1–3s/trang, đắt hơn ~10–15×/call** (vẫn vài xu) — prefetch che phần lớn độ trễ. Chấp nhận theo lựa chọn người dùng.
- **Prompt dài hơn** ⇒ +ít input token/call (không đáng kể).
- **Cache không phân biệt model/prompt** ⇒ phải bump `CACHE_VERSION` để thấy bản mới; nếu quên sẽ tưởng "không đổi gì". Ghi rõ trong plan.
- **OCR tiếng Anh** không chắc chắn — nhưng ngoài phạm vi (không do thay đổi này gây ra).
- Nội dung 18+: prompt yêu cầu dịch trung thực; nếu OpenAI từ chối một số nội dung cực đoan thì đó là giới hạn phía API, không sửa được từ prompt.
