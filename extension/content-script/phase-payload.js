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
  if (engine === 'chatgpt' && gptConfigPath) body.gpt_config = gptConfigPath;
  if (context && context.length) body.context = Array.from(context);
  return body;
}
