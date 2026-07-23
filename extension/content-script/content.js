(function () {
  'use strict';

  const CFG = {
    // gpt_config chi nhan DUONG DAN file tren SERVER (khong nhan noi dung
    // YAML truc tiep) - file nay da duoc dong goi vao image da va, xem
    // Dockerfile + patches/gpt_config-vi.yaml.
    GPT_CONFIG_PATH: '/app/gpt_config-vi.yaml',
    // lama_mpe: da thu lama_large (so sanh rieng tren backend co ve tot hon)
    // nhung khi test thuc te (render qua userscript) KHONG thay ro ret hon -
    // da revert lai lama_mpe. lama_mpe cung nhe hon, an toan VRAM hon (~3.4GB
    // vs ~3.7GB/4GB). Xem README.md muc "Inpaint that".
    INPAINTER: 'lama_mpe',
    INPAINTING_SIZE: 1024,
    MIN_NW: 400,
    MIN_NH: 400,
    MIN_DISPLAY_RATIO: 0.3,
    TIMEOUT_MS: 90000, // GPU laptop + throttle nhiet -> de rong
    FONT: '"Be Vietnam Pro", "Nunito", sans-serif',
    // (Da bo BG_PAD - tung noi rong khung nen 8% + keo gian anh inpaint
    // cho vua, nhung tren nen mau/gradient viec keo gian tao ra "mieng va"
    // hinh chu nhat lech mau rat de nhan ra. Gio khung nen khit dung bbox
    // backend tra ve, khong keo gian.)
    TEXTBOX_PAD: 0.1, // noi khung DAT CHU 10% (khung nen/inpaint KHONG noi - xem render())
    FIT_SAFETY: 0.92, // chua margin nho khi fit chu (tranh cham sat mep)
    FONT_MIN: 8,
    // Cu chu MAC DINH dung chung cho MOI vung chu - dam bao dong nhat (giong
    // truyen that duoc dan trang deu 1 co chu). Chi GIAM xuong khi vung qua
    // chat, KHONG BAO GIO tang len de "lap day" khung thua.
    FONT_DEFAULT: 16,
    // TANG SO NAY MOI KHI DOI config gui len backend (INPAINTER, GPT_CONFIG_PATH,
    // TARGET_LANG...) - cache se TU DONG bo qua ket qua cu (khong can nguoi
    // dung tu xoa Storage tay). Da gap loi thuc te: doi config nhung quen xoa
    // cache -> test nham phai ket qua cu, tuong nhu code khong hoat dong.
    CACHE_VERSION: 5, // sua prompt gpt_config-vi.yaml thieu chi dan giu marker <|N|> (xem patches/gpt_config-vi.yaml)
    // Da xac nhan thuc nghiem o Giai doan B: backend xu ly TUAN TU (khong
    // song song), tang CONCURRENCY khong co loi ich - xem README.md.
    CONCURRENCY: 1,
    // IntersectionObserver bat dau dich TRUOC khi anh vao khung nhin that
    // su, de kip dich xong khi nguoi doc cuon toi (che giau do tre inpaint).
    PREFETCH_MARGIN: '200% 0px',
    // Webtoon dai (5.7): anh cao hon TILE_MAX_H bi cat thanh nhieu lat,
    // chong lan TILE_OVERLAP px, gui rieng tung lat cho backend. 4000 (chu
    // khong 16000) de co bien an toan - gioi han TONG DIEN TICH canvas cua
    // trinh duyet cung ton tai, khong chi gioi han chieu cao (xem spec 5.7).
    TILE_MAX_H: 4000,
    TILE_OVERLAP: 200,
    // Ghep bien anh lien ke: muon them BOUNDARY_BORROW_HEIGHT px dau cua anh
    // KE TIEP truoc khi gui detect, de bong bong/cau van bi site tu cat
    // ngang giua 2 file anh van duoc nhin thay du. 500px du cho hau het bong
    // bong thuc te da quan sat (cao nhat ~300-400px). Xem spec
    // 2026-07-23-cross-image-boundary-stitching-design.md.
    BOUNDARY_BORROW_HEIGHT: 500,
    // AI inpaint (lama_mpe) xoa chu rat tot tren nen trang phang (bong
    // thoai thuong), nhung de lai vet mo/nhoe ro ret tren nen nhieu mau/
    // chi tiet (toc, gradient, net ve day) - gioi han cua chinh model, da
    // thu ca lama_large cung khong kha hon (xem README.md muc "Inpaint
    // that"). Do DO LECH CHUAN (standard deviation) cua do sang trong bbox
    // ANH DA INPAINT (r.background - v0.31, KHONG PHAI anh goc nua, xem
    // ghi chu v0.31 o dau file) de doan nen sau inpaint co sach khong: nen
    // sach (da xoa chu) co std rat thap (do thuc te: 0.4-2.8), nen con
    // nhoe/nhieu mau/chi tiet se std cao hon han. Vung vuot nguong nay se
    // BO HAN lop nen inpaint (chi con chu vien trang de tren anh goc, xem
    // OverlayRenderer.render()) thay vi hien 1 mieng inpaint mo. Da xac
    // nhan chieu "sach" cua nguong bang test that (xem v0.31); CHUA co vi
    // du that cua nen "con nhoe" de xac nhan chieu con lai.
    BUSY_STD_THRESHOLD: 25,
  };

  function log(...args) {
    console.log('[MOT]', ...args);
  }

  // ===== ImageFinder =====
  const ImageFinder = {
    findCandidates() {
      return Array.from(document.querySelectorAll('img')).filter((img) => this.isCandidate(img));
    },
    isCandidate(img) {
      // Nhieu site lazy-load dat src TAM la anh placeholder (thuong la data:
      // URI - SVG shimmer/"Loading..." dung dung kich thuoc anh that de
      // tranh layout shift) roi moi thay bang URL that khi cuon toi.
      // Placeholder loai nay De qua duoc bo loc kich thuoc ben duoi (vi co
      // width/height khop voi anh that) nhung gui no cho backend se loi
      // 422 (khong phai anh manga that) - loai tu day, cho src that.
      const src = img.currentSrc || img.src;
      if (src.startsWith('data:')) return false;
      if (!img.naturalWidth || !img.naturalHeight) return false;
      if (img.naturalWidth < CFG.MIN_NW || img.naturalHeight < CFG.MIN_NH) return false;
      if (img.clientWidth / window.innerWidth < CFG.MIN_DISPLAY_RATIO) return false;
      if (img.closest('header, nav, footer, aside')) return false;
      const idClass = `${img.id} ${img.className}`.toLowerCase();
      if (/logo|avatar|icon|banner|ad|thumb|sprite/.test(idClass)) return false;
      const ratio = img.naturalHeight / img.naturalWidth;
      if (ratio < 0.5 || ratio > 100) return false;
      return true;
    },
  };

  // ===== Cache (hash bytes anh, khong theo URL) =====
  // Khac ban userscript goc: GM_getValue/GM_setValue la dong bo, con
  // chrome.storage.local la bat dong bo - Cache.get()/set() gio la async,
  // moi noi goi chung (translateAndRenderImage, Task 9) phai await.
  const Cache = {
    async hashBlob(blob) {
      const buf = await blob.arrayBuffer();
      if (crypto?.subtle) {
        const h = await crypto.subtle.digest('SHA-256', buf);
        return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
      const u8 = new Uint8Array(buf);
      let h = 0x811c9dc5;
      for (let i = 0; i < u8.length; i++) {
        h ^= u8[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return 'fnv' + h.toString(16) + '_' + u8.length;
    },
    // targetLang/engine duoc dua vao key vi ca 2 gio doi duoc ngay luc dung
    // (qua popup) - thieu 1 trong 2 trong key se tra nham ket qua ngon
    // ngu/engine cu tu cache (xem spec 2026-07-22-extension-popup-settings-design.md
    // muc 8 va 2026-07-23-translator-engine-picker-design.md muc 6).
    _key(hash, targetLang, engine) {
      return `mot_cache_v${CFG.CACHE_VERSION}_${engine}_${targetLang}_${hash}`;
    },
    async get(hash, targetLang, engine) {
      const key = this._key(hash, targetLang, engine);
      const result = await chrome.storage.local.get(key);
      return result[key] ? JSON.parse(result[key]) : null;
    },
    async set(hash, targetLang, engine, value) {
      const key = this._key(hash, targetLang, engine);
      await chrome.storage.local.set({ [key]: JSON.stringify(value) });
    },
  };

  async function computeRegionComplexity(regions) {
    return Promise.all(
      regions.map(async (r) => {
        if (!r.background) return false;
        try {
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Khong giai ma duoc anh background'));
            img.src = r.background;
          });
          const w = img.naturalWidth || 1;
          const h = img.naturalHeight || 1;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, w, h).data;
          // Do lech chuan cua do sang (luminance), lay mau 1/4 diem anh de
          // nhanh hon (du dai dien, khong can quet tung pixel).
          let sum = 0;
          let sumSq = 0;
          let n = 0;
          for (let i = 0; i < data.length; i += 16) {
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            sum += lum;
            sumSq += lum * lum;
            n++;
          }
          if (n === 0) return false;
          const mean = sum / n;
          const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
          return std > CFG.BUSY_STD_THRESHOLD;
        } catch (err) {
          return false; // khong doc duoc (hiem gap) -> mac dinh coi la don gian, van hien nen nhu cu
        }
      })
    );
  }

  // Doc pixel truc tiep tu 1 <img> DA HIEN THI (da giai ma san trong bo
  // nho trinh duyet) bang canvas - dung cho anh co src la blob:/data: URL
  // co the da bi thu hoi/khong con truy cap lai qua mang duoc (xem
  // downloadImageBlob).
  function imageElementToBlob(img) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Khong doc duoc pixel tu <img> (canvas bi tainted?)'));
      }, 'image/png');
    });
  }

  // v0.32: BACKEND (Pillow/Python) khong doc duoc mot so dinh dang anh
  // trinh duyet hien thi binh thuong - xac nhan thuc te tren site that
  // (hitomi.la, CDN tra file .avif): backend loi HTTP 422 "cannot identify
  // image file <_io.BytesIO ...>" (Pillow khong co plugin AVIF). Trong khi
  // do trinh duyet giai ma duoc AVIF/WebP/hau het dinh dang hien dai (dung
  // de HIEN THI anh len trang). Re-encode blob tai ve THANH PNG qua canvas
  // TRUOC KHI gui cho backend - bao ve cho MOI dinh dang la Pillow co the
  // khong doc duoc, khong rieng AVIF.
  // v0.33: FIX BUG THAT (test that tren Coc Coc that, sau khi len v0.32) -
  // ban v0.32 dung createImageBitmap(blob) de giai ma, nhung Coc Coc bao
  // loi that "InvalidStateError: The source image could not be decoded."
  // ngay tai day - xac nhan qua test rieng: CUNG 1 blob AVIF that (dung
  // Content-Type/blob.type, tai qua network that giong GM_xmlhttpRequest),
  // createImageBitmap() lan luot OK tren Chromium test nhung Coc Coc that
  // lai FAIL - la 1 khac biet codec giua 2 API giai ma AVIF cua Chromium
  // (createImageBitmap() vs <img>), tung la loi da biet tren 1 so ban
  // Chromium: <img> co codec AVIF nhung createImageBitmap() thi khong,
  // dung ban Coc Coc nay la vi du. Sua: doi sang dung LAI cach <img> +
  // canvas (giong het imageElementToBlob() da dung on dinh o C2 cho
  // nhanh blob:/data: URL) thay vi createImageBitmap() - dang tin cay hon
  // qua nhieu trinh duyet/dinh dang, khong chi rieng vu AVIF nay.
  function reencodeToPng(blob) {
    return new Promise((resolve, reject) => {
      const objUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(objUrl);
        canvas.toBlob((out) => {
          if (out) resolve(out);
          else reject(new Error('Khong re-encode duoc anh sang PNG'));
        }, 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error('Khong giai ma duoc anh tai ve (dinh dang la?)'));
      };
      img.src = objUrl;
    });
  }

  console.log('[MOT] CFG/ImageFinder/Cache/helpers da nap xong (Task 6).');

  // Giai ma chuoi base64 (nhan tu background.js qua chrome.runtime message)
  // thanh Blob that. Dung base64 thay vi ArrayBuffer vi ArrayBuffer KHONG
  // duoc bao toan dang tin cay qua chrome.runtime.sendMessage/sendResponse
  // trong Manifest V3 - da xac nhan bang test that (res.arrayBuffer den noi
  // nay chi con la {} rong, Blob ket qua chi co 15 byte cua chuoi
  // "[object Object]" bi stringify nham thay vi du lieu nhi phan that).
  function base64ToBlob(base64, contentType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: contentType });
  }

  // Boc chrome.runtime.sendMessage (callback-style) thanh Promise, kiem tra
  // chrome.runtime.lastError - tranh loi im lang khi service worker bi tat
  // giua chung (xem docs/superpowers/specs/2026-07-21-browser-extension-port-design.md muc 8).
  function sendMessageAsync(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  const DEFAULT_TARGET_LANG = 'VIN';

  // Doc ngon ngu dich tu chrome.storage.local moi lan goi (khong cache vao
  // hang so co dinh) de doi ngon ngu trong popup (Task 5) co tac dung ngay
  // lap tuc cho lan dich tiep theo.
  async function getTargetLang() {
    const result = await chrome.storage.local.get('mot_target_lang');
    return result.mot_target_lang || DEFAULT_TARGET_LANG;
  }

  const DEFAULT_TRANSLATOR_ENGINE = 'chatgpt';

  // Doc engine dich tu chrome.storage.local moi lan goi (khong cache vao
  // hang so co dinh) de doi engine trong popup co tac dung ngay lap tuc cho
  // lan dich tiep theo (xem spec 2026-07-23-translator-engine-picker-design.md).
  async function getTranslatorEngine() {
    const result = await chrome.storage.local.get('mot_translator_engine');
    return result.mot_translator_engine || DEFAULT_TRANSLATOR_ENGINE;
  }

  // ===== ApiAdapter — NOI DUY NHAT BIET SCHEMA BACKEND =====
  const ApiAdapter = {
    async downloadImageBlob(img) {
      const src = img.currentSrc || img.src;
      if (src.startsWith('blob:') || src.startsWith('data:')) {
        // Khong doi: van doc pixel truc tiep tu <img> da hien thi, khong
        // relay qua background duoc vi du lieu chi ton tai tam thoi phia
        // trinh duyet (xem spec muc 5a diem 1).
        return await imageElementToBlob(img);
      }

      const res = await sendMessageAsync({ type: 'DOWNLOAD_IMAGE', url: src });
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Khong tai duoc anh goc: ' + src);
      }
      const rawBlob = base64ToBlob(res.base64, res.contentType);
      return await reencodeToPng(rawBlob);
    },

    blobToDataURL(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },

    async translateImage(blob) {
      const dataUrl = await this.blobToDataURL(blob);
      const targetLang = await getTargetLang();
      const engine = await getTranslatorEngine();
      const translatorConfig = {
        translator: engine,
        target_lang: targetLang,
      };
      // gpt_config (prompt La-tinh hoa ten rieng) chi co tac dung voi engine
      // ho GPT (chatgpt/gemini - ca 2 deu ke thua CommonGPTTranslator ben
      // backend, doc chung 1 co che prompt qua field gpt_config), KHONG co
      // tac dung voi deepl (kien truc khac han, khong doc gpt_config - xem
      // spec 2026-07-23-translator-engine-picker-design.md muc 3/6).
      if (targetLang === 'VIN' && engine !== 'deepl') {
        translatorConfig.gpt_config = CFG.GPT_CONFIG_PATH;
      }
      const body = JSON.stringify({
        image: dataUrl,
        config: {
          translator: translatorConfig,
          render: { renderer: 'none' },
          inpainter: { inpainter: CFG.INPAINTER, inpainting_size: CFG.INPAINTING_SIZE },
        },
      });

      const res = await sendMessageAsync({ type: 'TRANSLATE', body });
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Loi khong xac dinh khi goi backend');
      }
      return { regions: res.regions };
    },

    async translateImageTiled(blob, naturalW, naturalH, img) {
      const tiles = await sliceImageIntoTiles(blob, naturalW, naturalH);
      log(
        'Webtoon dai (' + naturalH + 'px > TILE_MAX_H ' + CFG.TILE_MAX_H + 'px) - cat thanh',
        tiles.length,
        'lat, chong lan',
        CFG.TILE_OVERLAP,
        'px.'
      );
      const allRegions = [];
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        // Chi lat CUOI CUNG moi thuc su giap ranh gioi voi anh ke tiep tren
        // trang - cac lat truoc da co TILE_OVERLAP xu ly rieng (xem spec
        // 2026-07-23-cross-image-boundary-stitching-design.md muc 8).
        const tileBlob = i === tiles.length - 1 ? await buildStitchedBlob(img, tile.blob) : tile.blob;
        const result = await this.translateImage(tileBlob);
        for (const r of result.regions) {
          allRegions.push({ ...r, y: r.y + tile.yOffset });
        }
      }
      return { regions: dedupeRegions(allRegions) };
    },
  };

  // Copy tu manga-overlay-translator.user.js dong 726-772
  async function sliceImageIntoTiles(blob, naturalW, naturalH) {
    const bitmap = await createImageBitmap(blob);
    const tiles = [];
    const step = CFG.TILE_MAX_H - CFG.TILE_OVERLAP;
    for (let y = 0; y < naturalH; y += step) {
      const h = Math.min(CFG.TILE_MAX_H, naturalH - y);
      const canvas = document.createElement('canvas');
      canvas.width = naturalW;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, y, naturalW, h, 0, 0, naturalW, h);
      const tileBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      tiles.push({ blob: tileBlob, yOffset: y, height: h });
      if (y + h >= naturalH) break; // da toi day anh (lat cuoi thap hon TILE_MAX_H)
    }
    bitmap.close?.();
    return tiles;
  }

  // Ty le giao/hop (Intersection over Union) giua 2 bbox {x,y,w,h}.
  function iou(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const interW = Math.max(0, x2 - x1);
    const interH = Math.max(0, y2 - y1);
    const interArea = interW * interH;
    if (interArea === 0) return 0;
    const unionArea = a.w * a.h + b.w * b.h - interArea;
    return interArea / unionArea;
  }

  // Loai bong thoai bi dich 2 lan o vung chong lan giua 2 lat ke nhau -
  // IoU > 0.5 coi la trung, giu bbox LON HON (spec 5.7 muc 4).
  function dedupeRegions(regions) {
    const kept = [];
    for (const r of regions) {
      const dupIdx = kept.findIndex((k) => iou(k, r) > 0.5);
      if (dupIdx === -1) {
        kept.push(r);
      } else if (r.w * r.h > kept[dupIdx].w * kept[dupIdx].h) {
        kept[dupIdx] = r;
      }
    }
    return kept;
  }

  // anh -> lop overlay tuong ung. Dung Map (khong phai WeakMap) vi
  // window resize listener ben duoi can DUYET LAI toan bo de tinh lai vi
  // tri hang loat.
  const imgLayers = new Map();

  // Tinh lai vi tri/kich thuoc layer theo dung <img> dang hien thi tren
  // trang. getBoundingClientRect() tra toa do theo VIEWPORT - cong them
  // window.scrollX/scrollY de quy ve toa do TRANG (layer dung
  // position:absolute, KHONG PHAI position:fixed, nen se tu cuon theo
  // trang nhu binh thuong, khong can nghe su kien scroll rieng).
  function positionLayer(img, layer) {
    const rect = img.getBoundingClientRect();
    // v0.36: FIX BUG THAT (test that tren hitomi.la) - site dang "reader"
    // (Prev/Next/Page N) giu <img> cua NHIEU trang trong DOM cung luc,
    // chi AN (display:none/kich thuoc 0) cac trang khong phai trang dang
    // xem thay vi xoa hang khoi DOM. Khi 1 <img> nhu vay bi an SAU KHI da
    // dich xong (overlay da gan vao <body>), moi lan positionLayer() chay
    // lai (window resize listener, hoac ResizeObserver rieng cua chinh
    // <img> do khi no tu co ve 0x0) se tinh rect = {0,0,0,0} -> layer bi
    // dat vao dung goc (0,0) cua trang - nhieu trang cu don lai CHONG LEN
    // NHAU dung 1 diem, hien ra nhu chu dich "nhay" vao goc trai man hinh
    // (loi thuc te da gap, xem anh chup). Sua: rect suy bien (w=0 hoac
    // h=0) -> day layer ra HAN NGOAI man hinh (khong dung
    // layer.style.display - thuoc tinh nay da danh rieng cho Alt+T bat/tat
    // so sanh goc/dich, doi o day se ghi de nham trang thai nguoi dung da
    // chon). Anh hien lai binh thuong (nguoi doc quay lai dung trang do)
    // se co rect that, tu dong quay ve vi tri dung.
    if (rect.width === 0 || rect.height === 0) {
      layer.style.left = '-99999px';
      layer.style.top = '-99999px';
      return;
    }
    layer.style.left = rect.left + window.scrollX + 'px';
    layer.style.top = rect.top + window.scrollY + 'px';
    layer.style.width = rect.width + 'px';
    layer.style.height = rect.height + 'px';
  }

  // Zoom/resize cua so co the doi kich thuoc/vi tri hien thi cua MOI anh
  // dang co overlay cung luc - tinh lai toan bo bang 1 listener chung,
  // nhe hon nhieu ResizeObserver rieng cho tung anh (van giu ResizeObserver
  // rieng trong render() de bat truong hop CHI 1 anh doi kich thuoc).
  window.addEventListener('resize', () => {
    imgLayers.forEach((layer, img) => positionLayer(img, layer));
  });

  // ===== OverlayRenderer — ve chu dich de len anh bang CSS (C2) =====
  const OverlayRenderer = {
    // Do do cao van ban khi ngat dong o khoang trang (word-break: keep-all),
    // dung CanvasRenderingContext2D.measureText de tranh layout thrashing.
    _measureWrappedHeight(ctx, text, fontSizePx, maxWidthPx) {
      ctx.font = `${fontSizePx}px ${CFG.FONT}`;
      const words = text.split(' ');
      let lines = 1;
      let lineWidth = 0;
      for (const word of words) {
        const wWidth = ctx.measureText(word + ' ').width;
        if (lineWidth > 0 && lineWidth + wWidth > maxWidthPx) {
          lines++;
          lineWidth = wWidth;
        } else {
          lineWidth += wWidth;
        }
      }
      return lines * fontSizePx * 1.25;
    },

    // Binary search font-size trong [FONT_MIN, FONT_DEFAULT] (KHONG phai mot
    // FONT_MAX lon - xem ghi chu CFG.FONT_DEFAULT). Tran -> thu nho hon. Lay
    // size lon nhat ma van vua, nhung khong bao gio vuot FONT_DEFAULT -> moi
    // vung chu dong nhat cung 1 co chu tru khi qua chat phai giam.
    _fitFontSize(text, maxWidthPx, maxHeightPx) {
      if (!this._measureCanvas) this._measureCanvas = document.createElement('canvas');
      const ctx = this._measureCanvas.getContext('2d');
      let lo = CFG.FONT_MIN;
      let hi = CFG.FONT_DEFAULT;
      let best = CFG.FONT_MIN;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const h = this._measureWrappedHeight(ctx, text, mid, maxWidthPx);
        if (h <= maxHeightPx) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best;
    },

    _fitTextboxFont(textbox, text) {
      const boxW = textbox.clientWidth * CFG.FIT_SAFETY;
      const boxH = textbox.clientHeight * CFG.FIT_SAFETY;
      if (boxW <= 0 || boxH <= 0) return;
      const size = this._fitFontSize(text, boxW, boxH);
      const textEl = textbox.querySelector('.mot-text');
      textEl.style.fontSize = size + 'px';
      if (size <= CFG.FONT_MIN) {
        const h = this._measureWrappedHeight(this._measureCanvas.getContext('2d'), text, size, boxW);
        textEl.classList.toggle('mot-overflow', h > boxH);
      }
    },

    // Chu Nhat goc thuong la cot doc HEP (vd rong 14px, cao 339px). Chu dich
    // tieng Viet luon ve NGANG (khong co field "vertical" trong API - xem
    // README.md), neu giu nguyen ti le hep-cao nay thi chu Viet bi nhoi vao
    // cot hep ~1 ky tu/dong, khong doc noi. Fix: "dinh hinh lai" thanh khung
    // rong hon CHI DE DAT CHU (khung nay TRONG SUOT, khong dung de che chu
    // goc - viec che chu la cua anh inpaint, xem render()). Han che do
    // "phinh ngang" (TARGET_ASPECT thap + gioi han max width) de giam
    // chong lan sang cot ben canh khi trang qua day dac.
    _reshapeForHorizontalText(r) {
      const centerX = r.x + r.w / 2;
      const centerY = r.y + r.h / 2;
      let w = r.w;
      let h = r.h;
      if (h > w * 1.3) {
        const area = w * h;
        const TARGET_ASPECT = 1.3;
        w = Math.min(Math.sqrt(area * TARGET_ASPECT), r.w * 3.5);
        h = area / w;
      }
      return { x: centerX - w / 2, y: centerY - h / 2, w, h };
    },

    async render(img, regions) {
      if (imgLayers.has(img)) {
        log('Anh nay da co overlay, bo qua ve lai.');
        return;
      }

      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;

      // Gan lop overlay THANG vao <body>, KHONG boc <img> bang <span> nua.
      // Ly do: mot so site dung viewer JS phuc tap (React/Webpack, vd
      // mangaz.com) tu quan ly cay DOM/layout rat chat che; them 1 <span>
      // cha moi quanh <img> co the vo tinh kich hoat resize/mutation
      // listener NOI BO cua viewer do, gay loi that su o chinh site (da
      // gap thuc te: viewer tu huy animation chuyen trang cua no vi tuong
      // nham kich thuoc/khung nhin thay doi). Gan vao body + tu tinh toa
      // do bang getBoundingClientRect() (xem positionLayer()) khong dung
      // gi den DOM cua <img> goc - an toan tuyet doi voi moi site, doi lai
      // phai tu cap nhat lai vi tri khi resize/zoom (xem window resize
      // listener + ResizeObserver ben duoi).
      const layer = document.createElement('div');
      layer.className = 'mot-layer';
      document.body.appendChild(layer);
      positionLayer(img, layer);
      imgLayers.set(img, layer);

      // QUAN TRONG: ve HET lop nen (LOP 1) truoc, roi moi ve HET lop chu
      // (LOP 2) sau, thanh 2 pass rieng - KHONG xen ke tung vung mot.
      // Phan tu ve SAU trong DOM luon nam TREN phan tu ve TRUOC. Neu xen
      // ke (nen vung1, chu vung1, nen vung2, chu vung2...), nen cua 1 vung
      // O DUOI co the de len chu cua 1 vung O TREN da ve truoc do (trang
      // nhieu cot sat nhau nhu anh test rat de gap) - loi thuc te da gap.

      // PASS 1 — LOP NEN: khit dung bbox backend tra ve (khong con noi
      // rong/keo gian - xem ghi chu CFG ve BG_PAD da bo). Bo qua han vung
      // "busy" (nhieu mau/chi tiet, xem computeRegionComplexity) - AI
      // inpaint tren vung nay thuong mo/nhoe ro ret, HIEN THI RA CON XAU
      // HON la khong hien gi ca; nhung vung do chi dua vao chu vien trang
      // (PASS 2) de doc duoc tren anh goc.
      regions.forEach((r) => {
        if (r.busy) return;

        const bg = document.createElement('div');
        bg.className = 'mot-bg';
        bg.style.left = (r.x / naturalW) * 100 + '%';
        bg.style.top = (r.y / naturalH) * 100 + '%';
        bg.style.width = (r.w / naturalW) * 100 + '%';
        bg.style.height = (r.h / naturalH) * 100 + '%';
        if (r.background) {
          bg.style.backgroundImage = `url(${r.background})`;
        }
        layer.appendChild(bg);
      });

      // PASS 2 — LOP CHU: rong hon (da dinh hinh lai) de chu Viet doc
      // duoc. Vung co nen inpaint sach (khong busy) thi TRONG SUOT (khong
      // ve nen gi them - vi phan mo rong nay co the tran ra ngoai vung da
      // inpaint, them 1 lop nen o day se de len chinh nen inpaint, thua
      // va co the lech mep). Vung "busy" (da bo han nen inpaint o PASS 1,
      // xem tren) thi CO nen trang mo + do bong (class .mot-busy) de chu
      // dich noi bat ro rang tren tranh goc nhieu mau/chi tiet, thay vi
      // chi dua vao vien trang (da du doc nhung khong "sach" bang).
      const textboxes = [];
      regions.forEach((r) => {
        const eff = this._reshapeForHorizontalText(r);
        const padW = eff.w * CFG.TEXTBOX_PAD;
        const padH = eff.h * CFG.TEXTBOX_PAD;
        const tx = Math.max(0, eff.x - padW / 2);
        const ty = Math.max(0, eff.y - padH / 2);
        const tw = Math.min(naturalW - tx, eff.w + padW);
        const th = Math.min(naturalH - ty, eff.h + padH);

        const textbox = document.createElement('div');
        textbox.className = 'mot-textbox' + (r.busy ? ' mot-busy' : '');
        textbox.style.left = (tx / naturalW) * 100 + '%';
        textbox.style.top = (ty / naturalH) * 100 + '%';
        textbox.style.width = (tw / naturalW) * 100 + '%';
        textbox.style.height = (th / naturalH) * 100 + '%';

        const text = document.createElement('span');
        text.className = 'mot-text';
        text.textContent = r.dst;
        textbox.appendChild(text);

        // C4: bam vao 1 khung chu de xem chu goc (vd doi chieu ban dich) -
        // bam lai de tro ve ban dich. Chi bat khi co chu goc that su.
        if (r.src) {
          textbox.title = 'Bấm để xem chữ gốc';
          let showingSrc = false;
          textbox.addEventListener('click', () => {
            showingSrc = !showingSrc;
            text.textContent = showingSrc ? r.src : r.dst;
            textbox.title = showingSrc ? 'Bấm để xem bản dịch' : 'Bấm để xem chữ gốc';
            this._fitTextboxFont(textbox, text.textContent);
          });
        }

        layer.appendChild(textbox);
        textboxes.push(textbox);
      });

      // Fit font sau khi da noi vao DOM (can kich thuoc px thuc te).
      requestAnimationFrame(() => {
        textboxes.forEach((box, i) => this._fitTextboxFont(box, regions[i].dst));
      });

      // Anh doi kich thuoc hien thi (zoom/resize/site tu doi layout) - vua
      // phai tinh lai VI TRI/KICH THUOC layer (khong con tu dong bam theo
      // <img> nhu cach boc <span> cu, vi layer gio o ngoai body), vua phai
      // fit lai FONT (do dai dong chu thay doi theo kich thuoc px moi).
      const ro = new ResizeObserver(() => {
        positionLayer(img, layer);
        textboxes.forEach((box, i) => this._fitTextboxFont(box, regions[i].dst));
      });
      ro.observe(img);

      log('Da ve overlay:', regions.length, 'vung chu (inpaint that)');
    },
  };

  // Thay GM_addStyle (khong ton tai trong extension) bang chen truc tiep
  // 1 the <style> vao <head> - content-script co toan quyen DOM cua
  // trang nen khong can ham tien ich rieng nhu Tampermonkey.
  // z-index toi da tren .mot-layer: nhieu trang (vd webtoons.com) dat cac the
  // wrapper cua <img> trong 1 stacking context rieng co z-index (vd .cont_box
  // z-index: 10) - .mot-layer la con truc tiep cua <body> nen neu khong co
  // z-index rieng se mac dinh thua (auto ~ 0 < 10), bi anh goc de len du duoc
  // them vao DOM sau (xac nhan thuc te qua elementFromPoint() tra ve <img>
  // thay vi overlay tren webtoons.com - xem dieu tra ngay 2026-07-22).
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .mot-layer { position: absolute; pointer-events: none; z-index: 2147483647; }

    .mot-bg {
      position: absolute;
      background-size: 100% 100%;
      background-repeat: no-repeat;
      pointer-events: none;
    }

    .mot-textbox {
      position: absolute;
      display: flex; align-items: center; justify-content: center;
      pointer-events: auto;
      box-sizing: border-box;
    }
    .mot-textbox.mot-busy {
      background: rgba(255, 255, 255, 0.85);
      border-radius: 6px;
      box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45);
    }
    .mot-text {
      width: 100%;
      color: #111;
      font-family: ${CFG.FONT};
      line-height: 1.25;
      text-align: center;
      word-break: keep-all;
      overflow-wrap: normal;
      hyphens: none;
      -webkit-text-stroke: 4px #fff;
      paint-order: stroke fill;
    }
    .mot-overflow { outline: 2px solid red; }
  `;
  document.head.appendChild(styleEl);

  console.log('[MOT] OverlayRenderer/CSS da nap xong (Task 8).');

  // ===== Ghep bien anh lien ke =====
  // Tim anh "ke tiep" theo toa do Y TUYET DOI tren trang (khong dua vao cau
  // truc DOM - moi site long <img> khac nhau). Dung de muon 1 dai bien phia
  // tren cua no, giup detector nhin thay tron ven noi dung bi site cat ngang
  // giua 2 file anh (xem spec 2026-07-23-cross-image-boundary-stitching-design.md).
  function findNextSiblingImage(img) {
    const myTop = img.getBoundingClientRect().top + window.scrollY;
    let best = null;
    let bestTop = Infinity;
    for (const candidate of registeredImages) {
      if (candidate === img) continue;
      if (!candidate.naturalWidth) continue; // chua load xong, bo qua
      const top = candidate.getBoundingClientRect().top + window.scrollY;
      if (top > myTop && top < bestTop) {
        best = candidate;
        bestTop = top;
      }
    }
    return best;
  }

  // Lay BOUNDARY_BORROW_HEIGHT px dau cua anh ke tiep. PHAI di qua
  // ApiAdapter.downloadImageBlob() (khong doc truc tiep pixel qua canvas tu
  // <img> song) - anh CDN cross-origin (khong co CORS header) se lam
  // TAINTED canvas ngay khi ve, giong ly do downloadImageBlob() da phai
  // relay qua background.js cho moi URL khong phai blob:/data:. Sau khi co
  // Blob thuan (khong con la <img> song), cat bang canvas moi an toan.
  async function getStripFromNextImage(nextImg, stripHeightPx) {
    const fullBlob = await ApiAdapter.downloadImageBlob(nextImg);
    const bitmap = await createImageBitmap(fullBlob);
    const h = Math.min(stripHeightPx, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, bitmap.width, h, 0, 0, bitmap.width, h);
    bitmap.close?.();
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  // Ghep canvas anh hien tai + dai bien cua anh ke tiep (neu co/tai duoc).
  // Khong co anh ke tiep, hoac tai loi (mang, site chan...) -> tra ve blob
  // GOC khong doi, khong chan tien do dich anh hien tai.
  async function buildStitchedBlob(img, blob) {
    const nextImg = findNextSiblingImage(img);
    if (!nextImg) return blob;

    let stripBlob;
    try {
      stripBlob = await getStripFromNextImage(nextImg, CFG.BOUNDARY_BORROW_HEIGHT);
    } catch (err) {
      return blob;
    }

    if (!stripBlob) return blob;

    const [currentBitmap, stripBitmap] = await Promise.all([
      createImageBitmap(blob),
      createImageBitmap(stripBlob),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = currentBitmap.width;
    canvas.height = currentBitmap.height + stripBitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(currentBitmap, 0, 0);
    ctx.drawImage(stripBitmap, 0, currentBitmap.height);
    currentBitmap.close?.();
    stripBitmap.close?.();

    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  // Registry toan cuc: moi vung chu da duoc VE THAT SU (khong phai chi
  // detect duoc) - luu toa do TUYET DOI tren trang, dung de tranh ve trung
  // khi anh ke tiep tu phat hien lai dung noi dung da bi anh truoc muon.
  const renderedPageBBoxes = [];

  function toPageBBox(img, region) {
    const rect = img.getBoundingClientRect();
    const pageTop = rect.top + window.scrollY;
    const scale = rect.height / img.naturalHeight;
    return {
      x: rect.left + region.x * scale,
      y: pageTop + region.y * scale,
      w: region.w * scale,
      h: region.h * scale,
    };
  }

  function isDuplicateOfRendered(img, region) {
    const candidate = toPageBBox(img, region);
    return renderedPageBBoxes.some((r) => iou(r, candidate) > 0.5);
  }

  function registerRenderedRegion(img, region) {
    renderedPageBBoxes.push(toPageBBox(img, region));
  }

  // ===== Job — tai + dich + ve overlay cho 1 anh (dung chung cho Queue) =====
  const state = { total: 0, done: 0, errors: 0 };
  // Luu loi chi tiet de nguoi dung bam nut xem lai (C4: "Loi - click xem"
  // - spec goc nghi cho 1 anh, o day gop thanh danh sach vi co nhieu anh).
  const errorLog = [];

  async function translateAndRenderImage(img) {
    if (imgLayers.has(img)) return;
    const tStart = performance.now();
    try {
      const blob = await ApiAdapter.downloadImageBlob(img);
      const hash = await Cache.hashBlob(blob);
      const targetLang = await getTargetLang();
      const engine = await getTranslatorEngine();
      let result = await Cache.get(hash, targetLang, engine);
      if (result) {
        log('Cache HIT:', hash, targetLang, engine, img.currentSrc || img.src);
      } else {
        log('Cache MISS, goi backend:', hash, targetLang, engine, img.currentSrc || img.src);
        result =
          img.naturalHeight > CFG.TILE_MAX_H
            ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight, img)
            : await ApiAdapter.translateImage(await buildStitchedBlob(img, blob));
        await Cache.set(hash, targetLang, engine, result);
      }
      // Loc bo vung chu da duoc anh TRUOC ve roi (qua ghep-bien muon dai
      // tren cua anh nay) - tranh ve trung 2 lan cung 1 noi dung (xem spec
      // 2026-07-23-cross-image-boundary-stitching-design.md muc 6).
      result.regions = result.regions.filter((r) => {
        if (isDuplicateOfRendered(img, r)) return false;
        registerRenderedRegion(img, r);
        return true;
      });
      const busyFlags = await computeRegionComplexity(result.regions);
      result.regions.forEach((r, i) => {
        r.busy = busyFlags[i];
      });
      await OverlayRenderer.render(img, result.regions);
      log('Da ve overlay:', result.regions.length, 'vung chu, tong', (performance.now() - tStart).toFixed(0), 'ms');
      state.done++;
    } catch (err) {
      console.error('[MOT] Loi dich anh:', img.currentSrc || img.src, err);
      state.errors++;
      errorLog.push({ src: img.currentSrc || img.src, message: err.message });
    }
  }

  // ===== Queue — gioi han CONCURRENCY, uu tien anh dang gan khung nhin =====
  const Queue = {
    _pending: [], // danh sach <img> dang cho, FIFO (IntersectionObserver da
    // uu tien theo khoang cach toi khung nhin qua PREFETCH_MARGIN)
    _active: 0,
    _queued: new Set(), // tranh enqueue trung 1 anh 2 lan

    enqueue(img) {
      if (this._queued.has(img)) return;
      if (imgLayers.has(img)) return; // da dich xong
      this._queued.add(img);
      this._pending.push(img);
      // v0.39: do thoi gian TAM THOI - danh dau luc anh vao hang doi de
      // tinh THOI GIAN CHO THAT SU (xem _drain()) truoc khi bat dau xu ly.
      // Voi CONCURRENCY:1, neu nhieu anh duoc prefetch dồn cùng lúc (cuon
      // nhanh qua nhieu anh), anh sau phai doi HET anh truoc xu ly xong
      // (~7-8s/anh that, xem log Docker da doi chieu) - day la 1 nguon do
      // tre THAT co the cai thien (vd tang PREFETCH_MARGIN de bat dau som
      // hon, hoac giam so anh dong thoi bi kich hoat), khac voi thoi gian
      // xu ly AI thuan tuy (khong sua duoc bang code).
      img.__motEnqueuedAt = performance.now();
      this._drain();
    },

    // Huy job CHUA BAT DAU (anh cuon qua xa truoc khi kip xu ly). Job DANG
    // CHAY (da goi backend) KHONG bi huy giua chung - tranh phi cong da lam
    // va tranh phuc tap huy request dang bay.
    cancel(img) {
      const idx = this._pending.indexOf(img);
      if (idx === -1) return; // khong trong hang doi (co the dang active roi) -> bo qua
      this._pending.splice(idx, 1);
      this._queued.delete(img);
      log('Huy job (cuon qua xa, chua kip dich):', img.currentSrc || img.src);
    },

    async _drain() {
      if (this._active >= CFG.CONCURRENCY) return;
      const img = this._pending.shift();
      if (!img) return;
      this._active++;
      // v0.39: log THOI GIAN CHO trong hang doi (khac thoi gian XU LY that
      // trong translateAndRenderImage) + so anh KHAC con dang cho phia sau -
      // giup phan biet "cham vi phai xep hang sau anh khac" (co the cai
      // thien: tang PREFETCH_MARGIN, danh dau anh som hon) voi "cham vi
      // chinh no dang xu ly AI that" (khong sua duoc, xem log timing trong
      // translateAndRenderImage).
      const queueWaitMs = img.__motEnqueuedAt ? performance.now() - img.__motEnqueuedAt : 0;
      log(
        `DEBUG queue: cho ${queueWaitMs.toFixed(0)}ms truoc khi bat dau xu ly, con ${this._pending.length} anh khac dang xep hang phia sau`,
        img.currentSrc || img.src
      );
      try {
        await translateAndRenderImage(img);
      } finally {
        this._queued.delete(img);
        this._active--;
        this._drain(); // xu ly tiep job ke tiep trong hang doi (neu co)
      }
    },
  };

  // ===== Tu dong phat hien anh (MutationObserver cho lazy-load) + prefetch
  // (IntersectionObserver) — day chinh la phan "auto + cuon" cua C3 =====
  // Set (khong phai WeakSet) vi C4 can duyet lai toan bo khi nguoi dung bam
  // nut (retroactive observe cho anh tim thay TRUOC khi bam).
  const registeredImages = new Set();
  let intersectionObserver = null;

  function registerImage(img) {
    if (registeredImages.has(img)) return;
    const tryRegister = () => {
      if (registeredImages.has(img)) return;
      if (!ImageFinder.isCandidate(img)) return;
      registeredImages.add(img);
      state.total++;
      // Neu auto mode da chay roi (da kich hoat dich roi, anh nay moi xuat
      // hien sau, vd lazy-load) thi theo doi ngay; neu chua kich hoat thi
      // chi dang ky, se duoc observe hang loat luc kich hoat (xem startAutoMode()).
      if (intersectionObserver) intersectionObserver.observe(img);
    };
    tryRegister(); // thu ngay - co the anh da tai xong that su tu dau
    // 'load' bat MOI LAN src doi va tai xong xong, KHONG CHI lan dau
    // ({ once: true } cu se bo lo lan site thay placeholder bang URL
    // that). isCandidate() da loai data: URI (xem ImageFinder), nen lan
    // dau thuong bi tu choi boi placeholder, phai doi 'load' lan tiep
    // theo (khi site gan src that vao) moi dang ky duoc.
    img.addEventListener('load', tryRegister);
  }

  // Luon chay tu init(), doc lap voi viec da kich hoat dich hay chua - de
  // luon biet duoc co anh moi xuat hien tren trang khong (lazy-load).
  function watchImages() {
    document.querySelectorAll('img').forEach(registerImage);

    // Bat anh moi them vao DOM sau nay (lazy-load khi cuon, infinite scroll...).
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue; // chi quan tam Element node
          if (node.tagName === 'IMG') registerImage(node);
          node.querySelectorAll?.('img').forEach(registerImage);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function startAutoMode() {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            Queue.enqueue(entry.target);
          } else {
            Queue.cancel(entry.target);
          }
        }
      },
      { rootMargin: CFG.PREFETCH_MARGIN }
    );

    // Cac anh da tim thay TRUOC khi bam nut (tu watchImages()) - observe
    // hang loat ngay bay gio. Anh tim thay SAU se tu observe trong
    // registerImage() (vi luc do intersectionObserver da ton tai).
    registeredImages.forEach((img) => intersectionObserver.observe(img));

    log('Auto mode (C3) da bat dau. Dang theo doi anh moi + cuon trang...');
  }

  let autoStarted = false;

  // Gop thong diep loi than thien theo nguyen nhan (backend tat, timeout...
  // da phan loai san trong ApiAdapter.translateImage), hien qua alert() vi
  // day la userscript don gian, khong co UI panel rieng.
  function showErrorSummary() {
    const lines = errorLog.map((e) => `- ${e.src}\n  ${e.message}`);
    alert(
      `Dịch xong nhưng có ${errorLog.length} ảnh lỗi:\n\n${lines.join('\n')}`
    );
  }

  // Kich hoat dich (goi tu menu Tampermonkey HOAC hotkey Alt+D - xem
  // installTriggers()). DA BO nut noi trong trang (v0.15-v0.21): du thu
  // z-index toi da, Popover API/top layer, dinh ky gianh lai vi tri, chan
  // click o capture phase... van khong the dam bao 100% mot phan tu SONG
  // TRONG DOM cua trang se khong bi chinh trang do can thiep (ads co the
  // hijack theo vo van cach, trang co toan quyen voi DOM/JS cua no). Menu
  // Tampermonkey + hotkey la co che DUY NHAT nam NGOAI DOM cua trang,
  // trang web khong co cach nao voi toi de che/chan/hijack.
  function onTriggerTranslate() {
    if (autoStarted) {
      // Da chay roi - bam lai chi co y nghia khi dang bao loi (xem lai chi
      // tiet). He thong da tu dong theo doi ca trang, khong can kich hoat
      // lai nhu C1/C2 (moi lan dich 1 anh).
      if (errorLog.length > 0) showErrorSummary();
      else log('Da o che do tu dong roi (tong', state.total, ', xong', state.done, ', loi', state.errors, ').');
      return;
    }
    autoStarted = true;
    startAutoMode();
    log('Bat dau dich tu dong ca trang (Alt+T de bat/tat overlay so sanh goc/dich).');
  }

  // Alt+T: bat/tat toan bo overlay tren trang (so sanh nhanh goc/dich).
  // Alt+D: kich hoat dich (tuong duong bam menu Tampermonkey).
  function onKeyDown(e) {
    if (!e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 't') {
      e.preventDefault();
      document.querySelectorAll('.mot-layer').forEach((layer) => {
        layer.style.display = layer.style.display === 'none' ? '' : 'none';
      });
    } else if (key === 'd') {
      e.preventDefault();
      onTriggerTranslate();
    }
  }

  function init() {
    document.addEventListener('keydown', onKeyDown);
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'TRIGGER_TRANSLATE') {
        onTriggerTranslate();
        // BAT BUOC goi sendResponse() dong bo: neu khong, Chrome bao loi
        // "The message port closed before a response was received." cho
        // BEN GOI (popup.js, Task 3) du onTriggerTranslate() da chay thanh
        // cong - loi nay chi lo ra khi co code THAT SU dung callback voi
        // sendMessage (truoc popup, chua ai goi kem callback nen chua phat
        // hien duoc).
        sendResponse({ ok: true });
      }
    });
    watchImages();
    log('San sang. Bam icon extension hoac Alt+D de dich, Alt+T de bat/tat overlay.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
