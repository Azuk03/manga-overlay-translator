# Vietnamese Pronoun/Register Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vietnamese forms-of-address (ngôi xưng) consistent across separate translate calls for the same character/relationship, and narrow (not just cost-reduce) the quality gap when moving to a cheaper model — without adding any new recurring GPT API calls.

**Architecture:** Three independent changes. (1) `patches/gpt_config-vi.yaml` gets a low `temperature`, few-shot address-pair examples, and a capitalization-normalization rule — all additive, no restructuring. (2) `patches/main.py`'s per-series gpt_config writer becomes able to hold two independently-updatable blocks (a static character sheet + a rolling recent-dialogue window) instead of one, plus a new endpoint to update the second block. (3) `extension/content-script/content.js` gains a `RecentDialogue` module that accumulates translated lines in reading order and pushes them to the new endpoint after every image (both the live-viewing path and the hitomi-prefetch path), giving thin-context translate calls real narrative continuity.

**Tech Stack:** Python (FastAPI + OmegaConf, `patches/main.py`), YAML (`patches/gpt_config-vi.yaml`), plain JavaScript (`extension/content-script/content.js`, `extension/background/background.js`) — no build step anywhere in this project.

## Global Constraints

- Chỉ tối ưu cho ngôn ngữ đích tiếng Việt (`target_lang=VIN`) — không tổng quát hoá đa ngôn ngữ (theo yêu cầu người dùng khi brainstorm).
- **Không thêm bất kỳ lượt gọi GPT định kỳ nào.** Component 3 (RecentDialogue) chỉ dump lại text ĐÃ dịch (src->dst), KHÔNG tóm tắt bằng AI, KHÔNG gọi thêm model nào.
- Backend patches (`patches/*.py`, `patches/gpt_config-vi.yaml`) được **đóng gói (bake) vào Docker image** qua `Dockerfile` — sửa xong PHẢI `docker build` lại + recreate container (`run-backend.ps1`, không phải `docker restart`) để có hiệu lực. Không có test tự động cho phần backend — xác minh bằng `python -m py_compile` (cú pháp) + test logic trực tiếp trong container thật bằng `omegaconf` thật (đã làm mẫu khi viết plan này, xem Task 2).
- Không có test tự động cho phần extension — xác minh bằng `node --check` (cú pháp) + xác minh thủ công trên Chrome/Edge thật + backend Docker thật (khớp mọi plan trước của dự án này). Người thực thi plan này KHÔNG có quyền truy cập trình duyệt — các bước xác minh thủ công được đánh dấu rõ và giao lại cho con người.
- Đổi prompt/config làm thay đổi output backend cho các trang ĐÃ cache → **PHẢI bump `CFG.CACHE_VERSION`** trong `content.js` (khớp quy ước mọi thay đổi ảnh hưởng output trước đó trong dự án).
- Spec đầy đủ: `docs/superpowers/specs/2026-08-12-vietnamese-translation-pronoun-consistency-design.md` — đọc trước khi bắt đầu.
- **Mọi block code "Thay bằng" trong plan này đã được xác minh áp dụng sạch (khớp chính xác byte-cho-byte với file thật, không mơ hồ) và test cú pháp/logic thật TRƯỚC khi viết plan** — nếu đọc file thực tế không khớp đúng "Đọc lại đúng nội dung hiện tại" bên dưới, DỪNG LẠI và báo BLOCKED thay vì tự đoán.

---

### Task 1: Prompt-level fixes (temperature + few-shot + chuẩn hoá viết hoa)

**Files:**
- Modify (ghi đè toàn bộ nội dung): `patches/gpt_config-vi.yaml`

**Interfaces:**
- Consumes: không có gì từ task khác.
- Produces: key `temperature` (float) và nội dung `chat_system_template` mở rộng trong file base — Task 2 đọc file này qua `OmegaConf.load("/app/gpt_config-vi.yaml")` trong `_write_series_gpt_config`, không đổi cách gọi.

- [ ] **Step 1: Ghi đè toàn bộ `patches/gpt_config-vi.yaml`**

File hiện tại (112 dòng) đã được xác minh: nội dung mới bên dưới là SUPERSET thuần tuý (diff xác nhận chỉ có phần THÊM, không sửa/xoá dòng nào của bản gốc). Ghi đè toàn bộ file bằng nội dung sau:

```yaml
# Custom system prompt cho translator=chatgpt, target_lang=VIN.
# Yeu cau rieng: ten rieng/thuat ngu trong ngoac kep phai duoc dich hoac
# La-tinh hoa (romanized), KHONG duoc de nguyen chu Nhat (kana/kanji) trong
# ban dich - xem yeu cau nguoi dung trong qua trinh test C2.
#
# QUAN TRONG (bug thuc te da gap, xem README.md muc "gpt_config"): prompt
# nay THAY THE HOAN TOAN _CHAT_SYSTEM_TEMPLATE mac dinh cua
# manga_translator/translators/config_gpt.py, von co san dong bat buoc
# "Output each segment with its prefix (<|number|> format exactly)". Backend
# ghep nhieu dong OCR thanh 1 prompt kieu "<|1|>dong mot\n<|2|>dong hai" (xem
# CommonGPTTranslator._assemble_prompts trong common_gpt.py) va dung regex
# <\|\d+\|> de tach lai tung dong dich tu cau tra loi GPT - neu prompt
# khong day GPT giu nguyen marker <|N|> nay, GPT tra loi tu nhien khong co
# marker -> parser khong tach duoc -> "Found indices count (0) does not
# match expected count (N)" -> dich that bai, bi loc bo (rong). Vi target
# "VIN" khong khop few-shot example co san cua backend (chi co Chinese/
# English/Korean) nen KHONG co vi du minh hoa nao duoc gui kem - phai giai
# thich + cho vi du TRUC TIEP trong system prompt nay.
chat_system_template: >
  You are a professional translator specializing in manga, manhwa, manhua and
  doujin content. You translate into natural, fluent {to_lang}.

  INPUT FORMAT: the text to translate is split into numbered segments, each
  starting with a tag like <|1|>, <|2|>, <|3|>, etc.

  OUTPUT FORMAT (CRITICAL - do not deviate, translation cannot be parsed
  otherwise): output the translation of every segment prefixed with the
  EXACT SAME tag as in the input. Do not renumber, merge, split, omit, or
  invent any tag that was not present in the input. Output ONLY the tagged
  translations, nothing else (no notes, no explanations, no extra text).

  Example:
  INPUT:
  <|1|>こんにちは
  <|2|>元気ですか？
  OUTPUT:
  <|1|>Xin chào
  <|2|>Cậu khỏe không?

  MORE EXAMPLES (forms of address - see the FORMS OF ADDRESS rules below;
  a worked example is more reliable to follow than a rule alone, especially
  for smaller/cheaper models - these show the actual Vietnamese pair for
  each common relationship this content needs):

  Peers/friends:
  INPUT:
  <|1|>Hey, are you free tomorrow?
  <|2|>Yeah, I don't have anything planned.
  OUTPUT:
  <|1|>Này, mai cậu rảnh không?
  <|2|>Ừ, tớ không có kế hoạch gì cả.

  Inner monologue (no one being addressed):
  INPUT:
  <|1|>I can't believe this is happening.
  OUTPUT:
  <|1|>Mình không thể tin nổi chuyện này đang xảy ra.

  Hostile/rough:
  INPUT:
  <|1|>Get out of my way!
  <|2|>Make me.
  OUTPUT:
  <|1|>Tránh đường cho tao!
  <|2|>Thử xem mày làm được không.

  Authority/archaic (nobility, deity, powerful antagonist):
  INPUT:
  <|1|>Kneel before your master.
  <|2|>Never.
  OUTPUT:
  <|1|>Quỳ xuống trước chủ nhân của ngươi.
  <|2|>Không bao giờ.

  Elder/family:
  INPUT:
  <|1|>Grandma, I brought you some food.
  <|2|>Thank you, sweetheart.
  OUTPUT:
  <|1|>Bà ơi, cháu mang đồ ăn cho bà nè.
  <|2|>Cảm ơn cháu yêu.

  TRANSLATION RULES:
  - Translate into natural, spoken-register {to_lang} as used in manga/comics -
    never stiff, robotic, or word-for-word.
  - Source may be Japanese, Korean, Chinese, or English. Always translate fully
    into {to_lang}. The output must contain NO untranslated source text and NO
    raw non-Latin script (Japanese kana/kanji, Korean hangul, Chinese hanzi).
    For a non-Latin term with no natural {to_lang} word, use its romanized Latin
    form (Hepburn for JP, Revised Romanization for KR, Pinyin for ZH). English
    source is simply translated fully into {to_lang}.
  - FORMS OF ADDRESS / PRONOUNS (critical for natural {to_lang}; do NOT translate
    "I/you" literally - Vietnamese address is relational; see the MORE EXAMPLES
    block above for concrete illustrations of each pair below). Follow this
    procedure:
    1. For each line, infer who is speaking, who they address or refer to, and
       their relationship, relative age, gender and tone (warm / neutral / rude /
       formal / romantic / reverent) from the surrounding dialogue.
    2. Use the STANDARD Vietnamese address for whatever relationship the scene
       shows - you already know these; apply them even for relationships not
       listed here. Common pairs (self - other):
       - Close friends / same-age peers (DEFAULT): tớ-cậu (or mình-cậu). Never
         the stiff tôi/bạn for friends.
       - Neutral / polite adults: tôi-anh/chị (other seems older) or tôi-bạn
         (only true strangers).
       - Romantic / crush: the man or older/pursuer says anh (self)-em (other);
         the woman or younger says em-anh.
       - Senior -> junior (age or rank): anh/chị-em, or by name. Junior ->
         senior: em-anh/chị; cháu-chú/bác/cô/dì/ông/bà.
       - Family: con-bố/mẹ; cháu-ông/bà; siblings em <-> anh/chị by age.
       - Rough / hostile / insulting: tao-mày.
       - Authority, arrogance, nobility, deity, villain-of-power: ta-ngươi.
       - Historical / wuxia / court: ta-ngươi, huynh/đệ/tỷ/muội, tại hạ, tiền
         bối/hậu bối, bệ hạ-thần, sư phụ/đồ đệ, chủ nhân/nô tài, as fitting.
    3. Third person (he/she/they): anh ấy/cô ấy (peers, adults); ông ấy/bà ấy
       (elders); cậu ấy (young male); nó/hắn (child, contempt, villain); use the
       name when known.
    3b. INNER MONOLOGUE / NARRATION / thinking to oneself (a line with NO one
       being addressed - the character is thinking, or a narration box): the
       speaker MUST refer to themselves as "mình" (or "tôi" for adult/formal
       narration). NEVER use "tớ" in a solo thought - "tớ" only exists as the
       pair tớ-cậu when speaking TO another person, so "tớ" in monologue is
       ALWAYS wrong. A line with no clear listener, or a reflective/observing
       tone, is monologue: use mình/tôi. Default any first-person line to
       "mình" unless it is clearly speech directed at someone present.
    4. Match the emotional register: a tớ/cậu friend who turns furious or hostile
       switches to mày/tao or ta-ngươi; strangers who become lovers switch to
       anh/em; a revealed noble is addressed reverently. Such shifts are CORRECT,
       not inconsistency - let the address track the CURRENT relationship/tone.
    5. CONSISTENCY: within one stable relationship state, reuse the same pair
       every time; never randomly alternate tớ<->tôi or cậu<->bạn for the same
       relationship. Change only when the story/tone genuinely changes it (rule 4).
    6. If the relationship is truly unclear: default to tớ/cậu for young/casual
       scenes, tôi-anh/chị for adult/formal scenes - never a flat tôi/bạn.
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
  - CAPITALIZATION: always output {to_lang} in normal sentence case (capitalize
    only the first letter of each sentence and proper nouns) - regardless of
    whether the source is ALL CAPS (common in hand-lettered/OCR'd comic text).
    Never mirror the source's capitalization style.
  - EMPHASIZED / large / bold / hand-drawn text - two cases:
    (A) If it is pure onomatopoeia / sound effect (SFX), a laugh (haha, hehe,
        kkk, ㅋㅋ), a wordless interjection, or a proper name already written in
        Latin letters, OUTPUT IT EXACTLY AS IN THE SOURCE, unchanged. This is the
        ONLY exception to the no-raw-source-script rule - keep it as-is so the
        original hand-drawn art is preserved (the client leaves such unchanged
        segments un-overlaid).
    (B) If it still carries real meaning (a real word/phrase, even if drawn big
        for emphasis), translate it accurately into {to_lang} like normal text.
  - A reader who cannot read the source language must fully understand every
    word of your output.

  Translate the following into {to_lang}.

# TANG DO ON DINH ngoi xung/dang ky xuyen suot CAC LUOT GOI KHAC NHAU: da do
# thuc te qua log GPT that (xem spec 2026-08-12-vietnamese-translation-
# pronoun-consistency-design.md) - CUNG 1 cau nguon, gui 2 lan RIENG BIET
# (khac anh/khac trang), ra 2 ngoi HOAN TOAN khac nhau (vd "ta/nguoi" roi
# "tao/may" cho cung 1 cau) - vi nhiet do MAC DINH 0.5 (config_gpt.py) chua
# tung duoc ta ep xuong, nen GPT ngau nhien hoa moi lan du cung input+prompt.
# 0.15 (khong phai 0 tuyet doi) de van giu chut tu nhien trong cach dien dat,
# nhung giam manh hien tuong "tung xuc xac" ngoi xung. Key nay duoc
# _write_series_gpt_config() (xem patches/main.py) tu dong sao chep nguyen
# ven vao MOI file gpt_config theo-truyen, khong can sua gi them.
temperature: 0.15
```

- [ ] **Step 2: Xác minh YAML hợp lệ + chứa đủ nội dung mới**

Run:
```bash
python -c "
import yaml
d = yaml.safe_load(open('patches/gpt_config-vi.yaml', encoding='utf-8'))
assert d['temperature'] == 0.15
t = d['chat_system_template']
assert '{to_lang}' in t and '<|1|>' in t
assert 'MORE EXAMPLES' in t and 'CAPITALIZATION' in t
print('OK: yaml valid, temperature=0.15, examples + capitalization rule present')
"
```
Expected: `OK: yaml valid, temperature=0.15, examples + capitalization rule present`, không có exception.

- [ ] **Step 3: Commit**

```bash
git add patches/gpt_config-vi.yaml
git commit -m "Lower temperature, add address-pair few-shot examples, normalize capitalization in VI prompt"
```

---

### Task 2: Backend — hồ sơ nhân vật mặc-định-bắt-buộc + endpoint hội thoại gần nhất

**Files:**
- Modify: `patches/main.py` (`_write_series_gpt_config`, `/set-series-context` khu vực — thêm model + endpoint mới ngay sau)

**Interfaces:**
- Consumes: `patches/gpt_config-vi.yaml`'s `temperature` key (Task 1, đã có sẵn cơ chế copy tự động, không cần sửa gì thêm ở đây).
- Produces: `_write_series_gpt_config(series_id, sheet=None, recent=None)` (chữ ký MỚI, 2 tham số cuối optional) — Task 3 gọi endpoint `/set-recent-dialogue` mới (không gọi hàm Python trực tiếp, gọi qua HTTP như `/set-series-context` đã có).

- [ ] **Step 1: Viết lại `_write_series_gpt_config` — hỗ trợ 2 khối độc lập, giữ nguyên khối không cập nhật**

Đọc lại đúng nội dung hiện tại:
```python
def _write_series_gpt_config(series_id: str, sheet: str) -> str:
    """Ghi 1 file gpt_config rieng cho truyen = base template + khoi CHARACTER
    CONTEXT. Tra ve duong dan file."""
    from omegaconf import OmegaConf
    base = OmegaConf.load("/app/gpt_config-vi.yaml")
    template = str(base.get("chat_system_template", ""))
    block = (
        "\n\nCHARACTER CONTEXT (REFERENCE DATA ONLY - the FORMS OF ADDRESS /"
        " PRONOUNS rules above ALWAYS take precedence; use this sheet only to"
        " identify who each character is and their DEFAULT dialogue address for"
        " consistency across the story):\n" + sheet.strip() + "\n"
        "If the CURRENT scene's relationship or tone conflicts with this sheet "
        "(e.g. a friendship turns hostile, a hidden relationship is revealed, "
        "someone's status changes), follow the CURRENT scene, not the sheet.\n"
        "The pronoun pairs above are for DIALOGUE between characters. In inner "
        "monologue / narration / a character thinking to themselves, they STILL "
        "refer to themselves as \"mình\" (or \"tôi\"), NEVER their dialogue "
        "self-term such as \"tớ\" - this sheet does not override the monologue "
        "rule.\n"
    )
    merged = OmegaConf.create({"chat_system_template": template + block})
    for k, v in base.items():
        if k != "chat_system_template":
            merged[k] = v
    SERIES_CTX_DIR.mkdir(parents=True, exist_ok=True)
    out = SERIES_CTX_DIR / (_sanitize_series_id(series_id) + ".yaml")
    OmegaConf.save(merged, str(out))
    return str(out)
```

Thay bằng:
```python
def _write_series_gpt_config(series_id: str, sheet: str | None = None, recent: str | None = None) -> str:
    """Ghi 1 file gpt_config rieng cho truyen = base template + (tuy chon)
    khoi CHARACTER CONTEXT + (tuy chon) khoi RECENT DIALOGUE. sheet/recent la
    None => GIU NGUYEN gia tri da co trong file cu (neu co) - cho phep cap
    nhat rieng 1 trong 2 khoi ma khong lam mat khoi kia (vd
    /set-recent-dialogue goi lien tuc khong duoc xoa mat ho so nhan vat da
    xay truoc do, va nguoc lai). Tra ve duong dan file."""
    from omegaconf import OmegaConf
    base = OmegaConf.load("/app/gpt_config-vi.yaml")
    template = str(base.get("chat_system_template", ""))

    out = SERIES_CTX_DIR / (_sanitize_series_id(series_id) + ".yaml")
    prev_sheet = ""
    prev_recent = ""
    if out.exists():
        try:
            prev = OmegaConf.load(str(out))
            prev_sheet = str(prev.get("_series_sheet", "") or "")
            prev_recent = str(prev.get("_series_recent", "") or "")
        except Exception:
            pass

    final_sheet = sheet.strip() if sheet is not None else prev_sheet
    final_recent = recent.strip() if recent is not None else prev_recent

    blocks = ""
    if final_sheet:
        blocks += (
            "\n\nCHARACTER CONTEXT (DEFAULT ADDRESS PAIRS - use the pair below"
            " for EVERY line involving this character UNLESS the segment you"
            " are translating RIGHT NOW contains UNAMBIGUOUS evidence of a"
            " state change, e.g. a fight breaking out, a reveal, a confession."
            " Brevity or missing surrounding detail in a short segment is NOT"
            " evidence to deviate - short/ambiguous segments MUST use the"
            " default below, not a fresh guess):\n" + final_sheet + "\n"
            "The pronoun pairs above are for DIALOGUE between characters. In "
            "inner monologue / narration / a character thinking to "
            "themselves, they STILL refer to themselves as \"mình\" (or "
            "\"tôi\"), NEVER their dialogue self-term such as \"tớ\" - this "
            "sheet does not override the monologue rule.\n"
        )
    if final_recent:
        blocks += (
            "\n\nRECENT DIALOGUE (context only - this is dialogue that JUST"
            " HAPPENED right before what you are translating now, given so"
            " you can infer who is speaking/listening and stay consistent"
            " with the ongoing scene. Do NOT re-translate any of it and do"
            " NOT include it in your output - translate ONLY the numbered"
            " segments in the user message):\n" + final_recent + "\n"
        )

    merged = OmegaConf.create({
        "chat_system_template": template + blocks,
        "_series_sheet": final_sheet,
        "_series_recent": final_recent,
    })
    for k, v in base.items():
        if k != "chat_system_template":
            merged[k] = v
    SERIES_CTX_DIR.mkdir(parents=True, exist_ok=True)
    OmegaConf.save(merged, str(out))
    return str(out)
```

Lưu ý: `build_series_context`/`set_series_context` (2 hàm bên dưới) gọi `_write_series_gpt_config(data.series_id, sheet)` theo kiểu positional — chữ ký mới vẫn nhận đúng vị trí này (`sheet` là tham số thứ 2), KHÔNG cần sửa 2 call site đó.

- [ ] **Step 2: Thêm model + endpoint `/set-recent-dialogue`**

Đọc lại đúng nội dung hiện tại (endpoint cuối cùng của khu vực Option C):
```python
@app.post("/set-series-context", tags=["internal-api"])
async def set_series_context(data: SetSeriesContextRequest):
    sheet = (data.sheet or "").strip()
    if not sheet:
        return {"gpt_config_path": None}
    try:
        path = _write_series_gpt_config(data.series_id, sheet)
    except Exception as e:
        print(f"[series-context] write failed: {e}", flush=True)
        return {"gpt_config_path": None}
    return {"gpt_config_path": path}
```

Thay bằng:
```python
@app.post("/set-series-context", tags=["internal-api"])
async def set_series_context(data: SetSeriesContextRequest):
    sheet = (data.sheet or "").strip()
    if not sheet:
        return {"gpt_config_path": None}
    try:
        path = _write_series_gpt_config(data.series_id, sheet)
    except Exception as e:
        print(f"[series-context] write failed: {e}", flush=True)
        return {"gpt_config_path": None}
    return {"gpt_config_path": path}


class SetRecentDialogueRequest(BaseModel):
    series_id: str
    recent: str


@app.post("/set-recent-dialogue", tags=["internal-api"])
async def set_recent_dialogue(data: SetRecentDialogueRequest):
    recent = (data.recent or "").strip()
    try:
        path = _write_series_gpt_config(data.series_id, recent=recent)
    except Exception as e:
        print(f"[series-context] write failed: {e}", flush=True)
        return {"gpt_config_path": None}
    return {"gpt_config_path": path}
```

- [ ] **Step 3: Kiểm tra cú pháp**

Run: `python -m py_compile patches/main.py`
Expected: không lỗi, không output (thành công im lặng).

- [ ] **Step 4: Kiểm tra LOGIC thật bằng omegaconf thật trong container (không cần backend build lại — chỉ test hàm độc lập)**

Backend Docker (`manga_translator`) phải đang chạy thật (`docker ps` xác nhận).

Copy `patches/gpt_config-vi.yaml` (bản Task 1 đã sửa) vào container để làm base test:
```bash
docker cp patches/gpt_config-vi.yaml manga_translator:/tmp/test_gpt_config-vi.yaml
```

Tạo file test (nội dung chính xác dưới đây — mô phỏng lại đúng hàm `_write_series_gpt_config` mới, dùng omegaconf THẬT trong container) tại `/tmp/test_write_series.py` trong container:
```python
import sys
sys.path.insert(0, "/app")
from pathlib import Path
from omegaconf import OmegaConf
import re as _re

SERIES_CTX_DIR = Path("/tmp/series-ctx-test")
GPT_BASE = "/tmp/test_gpt_config-vi.yaml"

def _sanitize_series_id(series_id):
    s = _re.sub(r"[^A-Za-z0-9_-]", "_", series_id or "")[:120]
    return s or "unknown"

def _write_series_gpt_config(series_id, sheet=None, recent=None):
    base = OmegaConf.load(GPT_BASE)
    template = str(base.get("chat_system_template", ""))
    out = SERIES_CTX_DIR / (_sanitize_series_id(series_id) + ".yaml")
    prev_sheet = ""
    prev_recent = ""
    if out.exists():
        try:
            prev = OmegaConf.load(str(out))
            prev_sheet = str(prev.get("_series_sheet", "") or "")
            prev_recent = str(prev.get("_series_recent", "") or "")
        except Exception:
            pass
    final_sheet = sheet.strip() if sheet is not None else prev_sheet
    final_recent = recent.strip() if recent is not None else prev_recent
    blocks = ""
    if final_sheet:
        blocks += ("\n\nCHARACTER CONTEXT (DEFAULT ADDRESS PAIRS...):\n" + final_sheet + "\n...monologue rule.\n")
    if final_recent:
        blocks += ("\n\nRECENT DIALOGUE (context only...):\n" + final_recent + "\n")
    merged = OmegaConf.create({
        "chat_system_template": template + blocks,
        "_series_sheet": final_sheet,
        "_series_recent": final_recent,
    })
    for k, v in base.items():
        if k != "chat_system_template":
            merged[k] = v
    SERIES_CTX_DIR.mkdir(parents=True, exist_ok=True)
    OmegaConf.save(merged, str(out))
    return str(out)

p1 = _write_series_gpt_config("test-series", sheet="Roxy -> tot-cau; Rudy goi Roxy la 'co'")
c1 = OmegaConf.load(p1)
assert "Roxy" in str(c1.get("_series_sheet"))
assert str(c1.get("_series_recent")) == ""
assert "CHARACTER CONTEXT" in str(c1.get("chat_system_template"))
assert "RECENT DIALOGUE" not in str(c1.get("chat_system_template"))
assert float(c1.get("temperature")) == 0.15
print("TEST 1 PASS: sheet-only build correct, temperature inherited =", c1.get("temperature"))

p2 = _write_series_gpt_config("test-series", recent="A: hi -> Chao\nB: hi -> Chao")
c2 = OmegaConf.load(p2)
assert "Roxy" in str(c2.get("_series_sheet")), "sheet LOST after recent-only update!"
assert "hi -> Chao" in str(c2.get("_series_recent"))
assert "CHARACTER CONTEXT" in str(c2.get("chat_system_template")), "sheet block LOST from template!"
assert "RECENT DIALOGUE" in str(c2.get("chat_system_template"))
print("TEST 2 PASS: recent-only update preserved sheet, both blocks present in template")

p3 = _write_series_gpt_config("test-series", sheet="UPDATED SHEET TEXT")
c3 = OmegaConf.load(p3)
assert "UPDATED SHEET TEXT" in str(c3.get("_series_sheet"))
assert "Roxy" not in str(c3.get("_series_sheet"))
assert "hi -> Chao" in str(c3.get("_series_recent")), "recent LOST after sheet-only update!"
print("TEST 3 PASS: sheet-only update preserved recent")
print()
print("ALL 3 TESTS PASSED")
```

Copy vào container và chạy:
```bash
docker cp /tmp/test_write_series.py manga_translator:/tmp/test_write_series.py
docker exec manga_translator sh -lc "cd /tmp && python3 test_write_series.py"
```
Expected: in ra `TEST 1 PASS`, `TEST 2 PASS`, `TEST 3 PASS`, `ALL 3 TESTS PASSED`, không có `AssertionError`.

Dọn dẹp sau khi test xong:
```bash
docker exec manga_translator sh -lc "rm -rf /tmp/series-ctx-test /tmp/test_gpt_config-vi.yaml /tmp/test_write_series.py"
```

- [ ] **Step 5: Commit**

```bash
git add patches/main.py
git commit -m "Make character sheet default-binding + add /set-recent-dialogue endpoint for rolling context"
```

---

### Task 3: Extension — cửa sổ hội thoại gần nhất (client) + bump cache

**Files:**
- Modify: `extension/background/background.js` (route `SET_RECENT_DIALOGUE`)
- Modify: `extension/content-script/content.js` (`CFG` — bump CACHE_VERSION + thêm key mới; module `RecentDialogue` mới; `translateAndRenderImage`; `prefetchHitomiGallery`)

**Interfaces:**
- Consumes: endpoint `/set-recent-dialogue` (Task 2), message pattern `sendMessageAsync({type, payload})` đã có sẵn (dùng chung với `SET_SERIES_CONTEXT`).
- Produces: `RecentDialogue.append(seriesId, regions)` — không có task nào khác trong plan này phụ thuộc thêm.

- [ ] **Step 1: `background.js` — thêm route cho `SET_RECENT_DIALOGUE`**

Đọc lại đúng nội dung hiện tại:
```javascript
  // Option C: dung/tao lai ho so nhan vat per-truyen. Goi mang phai chay o
  // service worker (host_permissions) - content-script khong tu fetch backend.
  if (message.type === 'BUILD_SERIES_CONTEXT' || message.type === 'SET_SERIES_CONTEXT') {
    (async () => {
      try {
        const route = message.type === 'BUILD_SERIES_CONTEXT' ? '/build-series-context' : '/set-series-context';
        const r = await fetch(`${await getBackendUrl()}${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message.payload),
        });
        sendResponse({ ok: r.ok, data: r.ok ? await r.json() : null });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true; // giu channel mo cho sendResponse bat dong bo
  }
```

Thay bằng:
```javascript
  // Option C: dung/tao lai ho so nhan vat per-truyen, hoac cap nhat cua so
  // hoi thoai gan nhat (xem RecentDialogue trong content.js). Goi mang phai
  // chay o service worker (host_permissions) - content-script khong tu
  // fetch backend.
  if (
    message.type === 'BUILD_SERIES_CONTEXT' ||
    message.type === 'SET_SERIES_CONTEXT' ||
    message.type === 'SET_RECENT_DIALOGUE'
  ) {
    (async () => {
      try {
        const route =
          message.type === 'BUILD_SERIES_CONTEXT'
            ? '/build-series-context'
            : message.type === 'SET_SERIES_CONTEXT'
            ? '/set-series-context'
            : '/set-recent-dialogue';
        const r = await fetch(`${await getBackendUrl()}${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message.payload),
        });
        sendResponse({ ok: r.ok, data: r.ok ? await r.json() : null });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true; // giu channel mo cho sendResponse bat dong bo
  }
```

- [ ] **Step 2: `content.js` — bump `CACHE_VERSION`**

Đọc lại đúng nội dung hiện tại:
```javascript
    CACHE_VERSION: 19, // ghep bien tach lam 2 lan detect doc lap thay vi noi anh - doi tap region cache cho anh co bat stitch, buoc dich lai
```

Thay bằng:
```javascript
    CACHE_VERSION: 20, // prompt: temperature thap + few-shot ngoi xung + chuan hoa viet hoa + ho so nhan vat mac-dinh-bat-buoc + cua so hoi thoai gan nhat - doi output dich, buoc dich lai
```

- [ ] **Step 3: `content.js` — thêm CFG cho cửa sổ hội thoại gần nhất**

Đọc lại đúng nội dung hiện tại:
```javascript
    CTX_MIN_PAGES: 3,
    CTX_MIN_CHARS: 200,
```

Thay bằng:
```javascript
    CTX_MIN_PAGES: 3,
    CTX_MIN_CHARS: 200,
    // Cua so hoi thoai GAN NHAT (mo rong Option C): khong doi CTX_MIN_PAGES/
    // CTX_MIN_CHARS (van danh cho ho so nhan vat tinh) - day la lop RIENG,
    // bat dau tich luy tu ANH DAU TIEN, khong can dat nguong. Gioi han so
    // dong/ky tu de chi phi token them moi luot dich o muc nho. Xem spec
    // 2026-08-12-vietnamese-translation-pronoun-consistency-design.md.
    RECENT_DIALOGUE_MAX_LINES: 20,
    RECENT_DIALOGUE_MAX_CHARS: 600,
```

- [ ] **Step 4: `content.js` — thêm module `RecentDialogue` (ngay sau `SeriesCtx`, trước `translateAndRenderImage`)**

Đọc lại đúng nội dung hiện tại:
```javascript
      } finally {
        this._building = false;
      }
    },
  };

  async function translateAndRenderImage(img) {
```

Thay bằng:
```javascript
      } finally {
        this._building = false;
      }
    },
  };

  // ===== Option C mo rong: cua so hoi thoai GAN NHAT =====
  // Bo sung ho so nhan vat TINH (SeriesCtx o tren) bang 1 lop NGAN HAN: danh
  // sach cac dong da dich GAN DAY nhat theo dung thu tu doc, giup cac luot
  // dich chi co 1-2 dong ngan (khong du de tu suy ra ai-noi-voi-ai) van co
  // mach truyen de bam vao. KHONG doi CTX_MIN_PAGES/CTX_MIN_CHARS (van danh
  // rieng cho ho so nhan vat) - lop nay bat dau tich luy tu ANH DAU TIEN,
  // khong can dat nguong. KHONG ton them luot goi GPT nao - chi dump text
  // da dich (src->dst), khong tom tat bang AI. Xem spec
  // 2026-08-12-vietnamese-translation-pronoun-consistency-design.md.
  const RecentDialogue = {
    _buf: [], // {src, dst} theo dung thu tu doc, toi da RECENT_DIALOGUE_MAX_LINES
    async append(seriesId, regions) {
      const lines = (regions || [])
        .map((r) => ({ src: (r.src || '').trim(), dst: (r.dst || '').trim() }))
        .filter((l) => l.src && l.dst);
      if (!lines.length) return;
      this._buf.push(...lines);
      if (this._buf.length > CFG.RECENT_DIALOGUE_MAX_LINES) {
        this._buf = this._buf.slice(-CFG.RECENT_DIALOGUE_MAX_LINES);
      }
      const text = this._buf
        .map((l) => `${l.src} -> ${l.dst}`)
        .join('\n')
        .slice(-CFG.RECENT_DIALOGUE_MAX_CHARS);
      await sendMessageAsync({
        type: 'SET_RECENT_DIALOGUE',
        payload: { series_id: seriesId, recent: text },
      }).catch(() => null);
    },
  };

  async function translateAndRenderImage(img) {
```

- [ ] **Step 5: `content.js` — tính `seriesId` MỘT LẦN cho cả hàm `translateAndRenderImage` (thay vì chỉ trong nhánh Cache MISS)**

Đọc lại đúng nội dung hiện tại:
```javascript
      const targetLang = await getTargetLang();
      const engine = await getTranslatorEngine();
      const url = img.currentSrc || img.src;
      const urlCacheable = !!url && !url.startsWith('blob:') && !url.startsWith('data:');
      let result = null;

      // FAST PATH: tra cache theo URL -> hash -> ket qua, KHONG tai anh (bo qua
      // ~3.4s tai + hash). Chi trung khi da tung dich URL nay o dung lang/engine.
      if (urlCacheable) {
        const knownHash = await Cache.getHashByUrl(url);
        if (knownHash) {
          result = await Cache.get(knownHash, targetLang, engine);
          if (result) log('Cache HIT (URL, khong tai anh):', targetLang, engine, url);
        }
      }

      // SLOW PATH: tai anh + hash + tra hash-cache + (dich backend). Luu chi muc
      // URL->hash de lan sau vao fast-path.
      if (!result) {
        const blob = await ApiAdapter.downloadImageBlob(img);
        const hash = await Cache.hashBlob(blob);
        result = await Cache.get(hash, targetLang, engine);
        if (result) {
          log('Cache HIT (hash):', hash, targetLang, engine, url);
        } else {
          log('Cache MISS, goi backend:', hash, targetLang, engine, url);
          // Option C: neu bat ngu canh + dinh danh duoc truyen + engine ho GPT,
          // dung gpt_config rieng cua truyen (neu da dung ho so). Tat/khong dinh
          // danh duoc => gptConfigPath null => luong cu.
          let gptConfigPath = null;
          const ctxOn = await getCharacterContext();
          const seriesId =
            ctxOn && targetLang === 'VIN' && engine !== 'deepl' ? getSeriesId() : null;
          let st = null;
```

Thay bằng:
```javascript
      const targetLang = await getTargetLang();
      const engine = await getTranslatorEngine();
      const url = img.currentSrc || img.src;
      const urlCacheable = !!url && !url.startsWith('blob:') && !url.startsWith('data:');
      let result = null;

      // Option C: tinh seriesId 1 LAN cho ca ham (Cache MISS dung de xay
      // gpt_config path, VA cuoi ham dung de cap nhat RecentDialogue bat ke
      // Cache HIT hay MISS - noi dung nguoi doc vua "luot qua" van la mach
      // truyen dang dien ra, du la dich lai hay lay tu cache).
      const ctxOn = await getCharacterContext();
      const seriesId = ctxOn && targetLang === 'VIN' && engine !== 'deepl' ? getSeriesId() : null;

      // FAST PATH: tra cache theo URL -> hash -> ket qua, KHONG tai anh (bo qua
      // ~3.4s tai + hash). Chi trung khi da tung dich URL nay o dung lang/engine.
      if (urlCacheable) {
        const knownHash = await Cache.getHashByUrl(url);
        if (knownHash) {
          result = await Cache.get(knownHash, targetLang, engine);
          if (result) log('Cache HIT (URL, khong tai anh):', targetLang, engine, url);
        }
      }

      // SLOW PATH: tai anh + hash + tra hash-cache + (dich backend). Luu chi muc
      // URL->hash de lan sau vao fast-path.
      if (!result) {
        const blob = await ApiAdapter.downloadImageBlob(img);
        const hash = await Cache.hashBlob(blob);
        result = await Cache.get(hash, targetLang, engine);
        if (result) {
          log('Cache HIT (hash):', hash, targetLang, engine, url);
        } else {
          log('Cache MISS, goi backend:', hash, targetLang, engine, url);
          // Option C: neu bat ngu canh + dinh danh duoc truyen + engine ho GPT,
          // dung gpt_config rieng cua truyen (neu da dung ho so). Tat/khong dinh
          // danh duoc => gptConfigPath null => luong cu.
          let gptConfigPath = null;
          let st = null;
```

- [ ] **Step 6: `content.js` — gọi `RecentDialogue.append` sau khi lọc `result.regions`, trước khi tính busyFlags**

Đọc lại đúng nội dung hiện tại:
```javascript
        if (r.y + r.h > img.naturalHeight) {
          registerRenderedRegion(img, r);
        }
        return true;
      });
      const busyFlags = await computeRegionComplexity(result.regions);
```

Thay bằng:
```javascript
        if (r.y + r.h > img.naturalHeight) {
          registerRenderedRegion(img, r);
        }
        return true;
      });
      if (seriesId) {
        await RecentDialogue.append(seriesId, result.regions);
      }
      const busyFlags = await computeRegionComplexity(result.regions);
```

- [ ] **Step 7: `content.js` — nối `RecentDialogue` vào luồng prefetch hitomi (pipeline dịch RIÊNG, không đi qua `translateAndRenderImage`)**

Đọc lại đúng nội dung hiện tại (trong `prefetchHitomiGallery`):
```javascript
          if (!cached) {
            const gptConfigPath = st ? await SeriesCtx.resolvePath(st) : null;
            const result = await ApiAdapter.translateImage(blob, gptConfigPath);
            await Cache.set(hash, targetLang, engine, result);
            if (st && !st.built) await SeriesCtx.accumulateAndMaybeBuild(st, result, targetLang);
          }
```

Thay bằng:
```javascript
          if (!cached) {
            const gptConfigPath = st ? await SeriesCtx.resolvePath(st) : null;
            const result = await ApiAdapter.translateImage(blob, gptConfigPath);
            await Cache.set(hash, targetLang, engine, result);
            if (seriesId) await RecentDialogue.append(seriesId, result.regions);
            if (st && !st.built) await SeriesCtx.accumulateAndMaybeBuild(st, result, targetLang);
          }
```

(`seriesId` đã tồn tại sẵn ở đầu `prefetchHitomiGallery` — biến riêng, cùng tên nhưng khác scope với biến trong `translateAndRenderImage`, không xung đột.)

- [ ] **Step 8: Kiểm tra cú pháp**

Run:
```bash
node --check extension/content-script/content.js
node --check extension/background/background.js
```
Expected: cả 2 lệnh không lỗi.

- [ ] **Step 9: Commit**

```bash
git add extension/content-script/content.js extension/background/background.js
git commit -m "Add rolling recent-dialogue window (client) for thin-context translate calls"
```

---

## Final integration check (sau khi xong cả 3 task — cần con người/trình duyệt thật + rebuild backend, không thể tự động hoá)

- [ ] **Rebuild + recreate backend** (bắt buộc — patches được bake vào image): `docker build` lại image, sau đó chạy `run-backend.ps1` (KHÔNG dùng `docker restart` — không load patch mới, xem Global Constraints).
- [ ] Xoá cache dịch trong popup extension (bump CACHE_VERSION đã tự ép dịch lại, nhưng xoá thủ công để chắc chắn test từ đầu).
- [ ] Dịch lại đúng 3 case đã dùng để chứng minh bug (từ log GPT thật khi brainstorm): `"I RECKON IT COULD SWALLOW ALL YOUR LITTLE FRIENDS..."`, `"...YOU NEEDNT TROUBLE YOURSELF WITH ANY RITUAL ON MY ACCOUNT."`, `"ID RATHER NOT SAY."` — lặp lại nhiều lần (dịch lại, xoá cache, dịch lại), xác nhận ngôi xưng ra ỔN ĐỊNH qua các lần lặp (không còn "tung xúc xắc" giữa ta-ngươi/tao-mày/tôi-bạn cho cùng 1 câu).
- [ ] Đọc thử 1 chương thật với "Ngữ cảnh nhân vật" BẬT, theo dõi 1 cặp nhân vật lặp lại qua nhiều ảnh/trang — xác nhận ngôi xưng nhất quán xuyên suốt (đây là loại lỗi ban đầu thúc đẩy thiết kế này).
- [ ] Chạy lại `compare_models.py` (đã có sẵn từ phiên trước, script so sánh gpt-4o vs gpt-4o-mini) với prompt mới — so khoảng cách chất lượng với kết quả đã ghi nhận trước đó trong phiên (mini có thu hẹp khoảng cách không, dù không kỳ vọng bằng 4o hoàn toàn).
- [ ] Kiểm tra Console — không có lỗi `Uncaught`/`TypeError` nào liên quan tới `RecentDialogue`/`SET_RECENT_DIALOGUE` khi dịch cả trang lẫn khi prefetch hitomi gallery.
- [ ] `git log --oneline` từ commit đầu plan tới cuối — đối chiếu đúng 3 commit (1 cho mỗi task).
