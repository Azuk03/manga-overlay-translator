// Dung request cho hai pha cua mot trang.
//
// Pha A (GPU): detect + OCR + mask + inpaint, translator 'none' - KHONG goi
// GPT. Day chinh la endpoint cu, chi doi translator; khong can backend moi.
// Pha B (mang): chi dich chuoi, qua /translate/texts - khong cham GPU.
//
// Tach khoi content.js (nam trong IIFE, khong test duoc) theo dung khuon cua
// image-candidate.js / image-format.js.

function motPhaseAConfig(cfg) {
  return {
    detector: { detection_size: cfg.DETECTION_SIZE },
    // 'none' van tra ve toa do + text OCR. Khong ton GPT.
    translator: { translator: 'none', target_lang: 'VIN' },
    // PHAI ghi ro inpainter: bo trong thi backend dung mac dinh lama_large,
    // ngon VRAM hon lama_mpe (~3,7GB vs ~3,4GB) tren card 4GB.
    inpainter: { inpainter: cfg.INPAINTER, inpainting_size: cfg.INPAINTING_SIZE },
    render: { renderer: 'none' },
  };
}

function motPhaseBBody({ texts, targetLang, engine, gptConfigPath, context }) {
  const body = {
    texts: Array.from(texts),
    translator: engine,
    target_lang: targetLang,
  };
  // DIEU KIEN NAY PHAI GIONG HET ApiAdapter.translateImage() (content.js) va
  // popup.js: gpt_config la prompt tieng Viet, chi co tac dung voi engine ho GPT
  // (chatgpt VA gemini - ca hai ke thua CommonGPTTranslator ben backend), va chi
  // dung khi dich sang VIN. Truoc day o day chi so sanh engine === 'chatgpt',
  // lech ca hai dau so voi duong cu: gemini+VIN MAT prompt, con chatgpt+ENG lai
  // BI nhet prompt tieng Viet vao. Ca hai deu hong am tham (van co ban dich, chi
  // sai giong/sai ngon ngu).
  if (gptConfigPath && targetLang === 'VIN' && engine !== 'deepl') {
    body.gpt_config = gptConfigPath;
  }
  if (context && context.length) body.context = Array.from(context);
  return body;
}
