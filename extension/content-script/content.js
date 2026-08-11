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
    CACHE_VERSION: 11, // doc thoai xung "minh" (manh hon) + loc giu-nguyen an toan (khong sot tu Latin) - buoc dich lai
    // Option C: so trang gom chu goc truoc khi dung ho so nhan vat, va do dai
    // text toi thieu de dung (tranh dung tu trang gan trong). Xem spec
    // 2026-08-09-per-series-character-context-design.md.
    CTX_MIN_PAGES: 3,
    CTX_MIN_CHARS: 200,
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
    // Chi ghep-bien khi anh ke tiep NOI LIEN theo chieu doc (dinh cua no cach
    // day anh hien tai khong qua nguong nay). Webtoon that xep chong lien mach
    // (khoang ho 0 den vai chuc px); viewer CHUYEN TRANG chong cac anh len cung
    // 1 vi tri hoac dat cach xa -> khong lien tuc -> khong ghep, tranh muon nham
    // dai anh trang khac va tranh dedup ban qua trang (xem bug 2026-08-03).
    BOUNDARY_CONTIGUITY_TOL: 50,
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
      // ratio = cao/rong. Nguong duoi 0.4 (thay vi 0.5) de CHAP NHAN trang DOI
      // nam ngang cua mot so reader (vd MangaPlaza: 1442x688 ~ 0.475, truoc day
      // bi loai nham). Banner/ad thuong rong hon nhieu (ratio < 0.2) nen van bi
      // loai. Nguong tren 100 chan anh soc bat thuong.
      const ratio = img.naturalHeight / img.naturalWidth;
      if (ratio < 0.4 || ratio > 100) return false;
      return true;
    },
  };

  // ===== DEBUG (TAM THOI - go sau khi xong; bat/tat bang DBG) =====
  // Chan doan 3 van de tren MangaPlaza: (1) overlay troi khi scroll, (2) nhieu
  // anh khong duoc bat, (3) eager khong dich truoc. Alt+G = dump trang thai.
  const DBG = true;
  function candidateReason(img) {
    const src = img.currentSrc || img.src || '';
    if (src.startsWith('data:')) return 'data-uri';
    if (!img.naturalWidth || !img.naturalHeight) return 'no-natural(' + img.naturalWidth + 'x' + img.naturalHeight + ')';
    if (img.naturalWidth < CFG.MIN_NW || img.naturalHeight < CFG.MIN_NH) return 'too-small';
    if (img.clientWidth / window.innerWidth < CFG.MIN_DISPLAY_RATIO) return 'display-ratio(' + img.clientWidth + '/' + window.innerWidth + ')';
    if (img.closest('header, nav, footer, aside')) return 'in-chrome';
    const idClass = (img.id + ' ' + img.className).toLowerCase();
    if (/logo|avatar|icon|banner|ad|thumb|sprite/.test(idClass)) return 'id-class';
    const ratio = img.naturalHeight / img.naturalWidth;
    if (ratio < 0.4 || ratio > 100) return 'aspect(' + ratio.toFixed(3) + ')';
    return 'PASS';
  }
  function dbgScan(label) {
    if (!DBG) return;
    const imgs = [...document.querySelectorAll('img')];
    console.log(
      `[MOT-DBG] SCAN(${label}) eager=${eagerModeActive} autoStarted=${autoStarted} registered=${registeredImages.size} pending=${Queue._pending.length} active=${Queue._active} layers=${imgLayers.size} total=${state.total}/done=${state.done}/err=${state.errors} winScrollY=${window.scrollY} imgsInDom=${imgs.length}`
    );
    imgs.forEach((img, i) => {
      console.log(
        `[MOT-DBG]  img#${i} ${img.naturalWidth}x${img.naturalHeight} client=${img.clientWidth}x${img.clientHeight} reason=${candidateReason(img)} reg=${registeredImages.has(img)} layer=${imgLayers.has(img)} src=${(img.currentSrc || img.src || '').slice(0, 45)}`
      );
    });
    const first = imgs.find((im) => registeredImages.has(im)) || imgs[0];
    if (first) {
      let el = first.parentElement;
      let depth = 0;
      while (el && depth < 14) {
        const cs = getComputedStyle(el);
        const scrolls = el.scrollHeight > el.clientHeight + 4 || el.scrollWidth > el.clientWidth + 4;
        const ov = cs.overflow + cs.overflowY + cs.overflowX;
        if (scrolls && /(auto|scroll)/.test(ov)) {
          console.log(`[MOT-DBG]  scroll-container <${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}> scrollTop=${el.scrollTop} overflowY=${cs.overflowY}`);
        }
        if (cs.transform !== 'none') {
          console.log(`[MOT-DBG]  transformed-ancestor <${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}> transform=${cs.transform.slice(0, 40)}`);
        }
        el = el.parentElement;
        depth++;
      }
    }
  }

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

    // Chi muc URL anh -> hash NOI DUNG (khong kem lang/engine vi hash la hash
    // noi dung anh, doc lap ngon ngu). Cho phep tra cache MA KHONG phai tai +
    // hash lai anh (~3.4s) khi da biet hash tu lan truoc (xem spec
    // 2026-08-03-url-cache-fastpath-design.md).
    _urlKey(url) {
      return `mot_urlhash_v${CFG.CACHE_VERSION}_${url}`;
    },
    async getHashByUrl(url) {
      const key = this._urlKey(url);
      const result = await chrome.storage.local.get(key);
      return result[key] || null;
    },
    async setUrlHash(url, hash) {
      await chrome.storage.local.set({ [this._urlKey(url)]: hash });
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

  // Option C: doc toggle "ngu canh nhan vat" (mac dinh BAT). Live-read moi lan
  // nhu cac setting khac. Tat => hanh vi y het truoc Option C.
  async function getCharacterContext() {
    try {
      const { mot_character_context } = await chrome.storage.local.get('mot_character_context');
      return mot_character_context !== false; // default ON
    } catch {
      return true;
    }
  }

  const DEFAULT_EAGER_TRANSLATE = false;

  // Doc setting "dich truoc toan bo" tu chrome.storage.local - chi doc 1
  // lan luc startAutoMode() chay (xem CFG eager branch ben duoi), khong
  // phan ung dong neu doi giua chung 1 phien dich (giong TARGET_LANG/
  // TRANSLATOR_ENGINE - xem spec 2026-08-02-eager-webtoon-pretranslate-design.md).
  async function getEagerTranslate() {
    const result = await chrome.storage.local.get('mot_eager_translate');
    return result.mot_eager_translate === undefined
      ? DEFAULT_EAGER_TRANSLATE
      : result.mot_eager_translate;
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

    // gptConfigPath (tuy chon, Option C): duong dan gpt_config rieng cua truyen
    // (base template + ho so nhan vat). Khong truyen => dung CFG.GPT_CONFIG_PATH
    // mac dinh (hanh vi cu).
    async translateImage(blob, gptConfigPath) {
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
        translatorConfig.gpt_config = gptConfigPath || CFG.GPT_CONFIG_PATH;
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

    async translateImageTiled(blob, naturalW, naturalH, img, gptConfigPath) {
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
        const result = await this.translateImage(tileBlob, gptConfigPath);
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

  // Tinh lai vi tri toan bo layer, gom bang requestAnimationFrame (moi frame
  // chi 1 lan) de khong giat khi scroll/resize lien tuc.
  let _reposScheduled = false;
  function scheduleReposition() {
    if (_reposScheduled) return;
    _reposScheduled = true;
    requestAnimationFrame(() => {
      _reposScheduled = false;
      imgLayers.forEach((layer, img) => positionLayer(img, layer));
    });
  }

  // Zoom/resize cua so co the doi kich thuoc/vi tri hien thi cua MOI anh
  // dang co overlay cung luc - tinh lai toan bo bang 1 listener chung,
  // nhe hon nhieu ResizeObserver rieng cho tung anh (van giu ResizeObserver
  // rieng trong render() de bat truong hop CHI 1 anh doi kich thuoc).
  window.addEventListener('resize', scheduleReposition, { passive: true });

  // FIX (reader cuon bang container noi bo, vd MangaPlaza speedreader): layer
  // position:absolute chi tu bam theo cuon CUA WINDOW. Khi trang cuon bang 1
  // container co overflow rieng (hoac transform), window.scrollY KHONG doi ma
  // <img> van di chuyen trong viewport -> layer dung yen -> overlay "troi"/bi
  // keo lech. Phai tinh lai positionLayer moi khi co cuon. capture:true vi su
  // kien scroll KHONG bubble - phai bat o pha capture moi nhan duoc scroll cua
  // MOI phan tu long ben trong. passive:true de khong chan cuon. Voi trang cuon
  // window binh thuong day la no-op an toan: rect.top giam dung bang scrollY
  // tang nen (rect.top + scrollY) khong doi, khong ghi lai vi tri thua.
  let _lastScrollLog = 0;
  window.addEventListener(
    'scroll',
    (e) => {
      if (DBG && Date.now() - _lastScrollLog > 400) {
        _lastScrollLog = Date.now();
        const t = e.target;
        const desc =
          t === document || t === window || t === document.scrollingElement
            ? 'document/window'
            : t && t.tagName
            ? '<' + t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + '> scrollTop=' + t.scrollTop
            : String(t);
        let sample = '';
        const it = imgLayers.entries().next();
        if (!it.done) {
          const [img, layer] = it.value;
          sample = ` | sampleImgRectTop=${img.getBoundingClientRect().top.toFixed(0)} layerTop=${layer.style.top}`;
        }
        console.log(`[MOT-DBG] scroll on ${desc} winY=${window.scrollY}${sample}`);
      }
      scheduleReposition();
    },
    { capture: true, passive: true }
  );

  // FIX TRIET DE (vd MangaPlaza speedreader): mot so reader DI CHUYEN TRANG BANG
  // CSS transform tren container (log thuc te: <div#content-p1>
  // transform=matrix(...,-2328)) - viec nay KHONG phat su kien 'scroll' nen ca
  // listener scroll cung bo lo. Cach duy nhat bam duoc MOI kieu di chuyen (scroll,
  // transform, animation, layout doi) la tinh lai vi tri moi frame bang rAF.
  // Toi uu de khong ton: (a) DOC het getBoundingClientRect() truoc roi moi GHI
  // style -> 1 lan reflow/frame, khong thrash; (b) chi GHI layer nao rect THAT SU
  // doi (idle gan nhu mien phi, khong ghi thua -> khong invalidate layout);
  // (c) tu DUNG khi khong con overlay; (d) tam dung khi tab an (document.hidden).
  let _rafId = null;
  const _lastRect = new WeakMap();
  function repositionLoop() {
    _rafId = null;
    if (imgLayers.size === 0) return; // khong con overlay -> dung han
    const updates = [];
    imgLayers.forEach((layer, img) => {
      const r = img.getBoundingClientRect();
      const p = _lastRect.get(layer);
      if (!p || p.top !== r.top || p.left !== r.left || p.width !== r.width || p.height !== r.height) {
        updates.push([layer, r]);
        _lastRect.set(layer, { top: r.top, left: r.left, width: r.width, height: r.height });
      }
    });
    for (const [layer, r] of updates) {
      if (r.width === 0 || r.height === 0) {
        layer.style.left = '-99999px';
        layer.style.top = '-99999px';
      } else {
        layer.style.left = r.left + window.scrollX + 'px';
        layer.style.top = r.top + window.scrollY + 'px';
        layer.style.width = r.width + 'px';
        layer.style.height = r.height + 'px';
      }
    }
    if (!document.hidden) _rafId = requestAnimationFrame(repositionLoop);
  }
  function startRepositionLoop() {
    if (_rafId == null && !document.hidden && imgLayers.size > 0) {
      _rafId = requestAnimationFrame(repositionLoop);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) startRepositionLoop();
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
      startRepositionLoop(); // bam vi tri lien tuc (bat ca di chuyen bang transform)

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
      /* pointer-events:none -> overlay TRONG SUOT voi chuot: cuon + click di
         xuyen qua toi reader ben duoi. Truoc day 'auto' khien textbox hung
         wheel nen KHONG cuon duoc reader cuon bang container/transform (overlay
         nam tren <body>, ngoai container). Danh doi: khong con boi/chon-copy
         chu dich - chap nhan de uu tien cuon/dieu khien reader. */
      pointer-events: none;
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
    /* .mot-overflow: chu dich tran khoi o. Truoc day vien do 2px de danh dau,
       nhung gay roi mat -> bo vien (van giu class de logic khac dung neu can). */
    .mot-overflow { }

    .mot-toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      pointer-events: none;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      padding: 10px 16px;
      border-radius: 6px;
      font-family: sans-serif;
      font-size: 14px;
      opacity: 1;
      transition: opacity 0.3s ease;
    }
    .mot-toast-hide { opacity: 0; }
  `;
  document.head.appendChild(styleEl);

  console.log('[MOT] OverlayRenderer/CSS da nap xong (Task 8).');

  // ===== Ghep bien anh lien ke =====
  // Tim anh "ke tiep" theo toa do Y TUYET DOI tren trang (khong dua vao cau
  // truc DOM - moi site long <img> khac nhau). Dung de muon 1 dai bien phia
  // tren cua no, giup detector nhin thay tron ven noi dung bi site cat ngang
  // giua 2 file anh (xem spec 2026-07-23-cross-image-boundary-stitching-design.md).
  function findNextSiblingImage(img) {
    // Chi ghep bien cho anh DUNG/CAO (webtoon strip - bong bong co the bi cat
    // ngang giua 2 file anh xep doc). Anh NGANG (landscape, vd trang doi
    // MangaPlaza 1443x688) la TRANG RIENG BIET: bong bong khong tran sang trang
    // ke, nen ghep bien se muon nham noi dung dau trang sau -> dich trung, ve 2
    // overlay chong nhau (bug da xac nhan tren MangaPlaza). Bo qua stitching.
    if (img.naturalHeight <= img.naturalWidth) return null;
    const myRect = img.getBoundingClientRect();
    const myTop = myRect.top + window.scrollY;
    const myBottom = myRect.bottom + window.scrollY;
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
    // Chi coi la "anh ke tiep webtoon" khi no NOI LIEN theo chieu doc: dinh cua
    // no sat day anh hien tai (trong dung sai BOUNDARY_CONTIGUITY_TOL). Viewer
    // chuyen trang chong cac anh len cung 1 vi tri (dinh anh sau ~ dinh anh
    // hien tai, cach day 1 khoang = ca chieu cao anh) hoac dat cach xa -> lech
    // xa nguong -> tra ve null, khong ghep bien (xem bug dedup ban qua trang
    // 2026-08-03).
    if (best && Math.abs(bestTop - myBottom) > CFG.BOUNDARY_CONTIGUITY_TOL) {
      return null;
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

    try {
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

      const stitched = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return stitched || blob;
    } catch (err) {
      return blob;
    }
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
      x: rect.left + window.scrollX + region.x * scale,
      y: pageTop + region.y * scale,
      w: region.w * scale,
      h: region.h * scale,
    };
  }

  // Ty le giao/DIEN TICH NHO HON (khong phai IoU chuan giao/hop) - xac nhan
  // qua test that: vung ghep-bien cua 1 anh (VD nguyen cau "TAKE YOUR
  // TIME." gop 3 dong) rat khac kich thuoc so voi vung anh ke tiep TU
  // PHAT HIEN LAI (VD chi rieng dong "TIME." 1 dong) - IoU chuan (chia cho
  // DIEN TICH HOP, tuc ca 2 vung cong lai) se qua THAP du 1 vung nam GON
  // trong vung kia (da xac nhan thuc te: bong bong "TAKE YOUR TIME." van
  // bi ve trung "THỜI GIAN." rieng le du thu tu xu ly da dung - IoU
  // giua vung 3-dong va vung 1-dong khong vuot qua nguong 0.5). Dung ham
  // rieng nay (khong sua iou() dang dung chung cho dedupeRegions() - do la
  // truong hop 2 lat CUNG 1 anh, kich thuoc luon gan giong nhau, khong gap
  // van de nay) chia cho DIEN TICH NHO HON trong 2 vung, phan anh dung
  // "vung nho co nam gon trong vung lon khong" bat ke chenh lech kich thuoc.
  function overlapRatio(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const interW = Math.max(0, x2 - x1);
    const interH = Math.max(0, y2 - y1);
    const interArea = interW * interH;
    if (interArea === 0) return 0;
    const minArea = Math.min(a.w * a.h, b.w * b.h);
    return interArea / minArea;
  }

  function isDuplicateOfRendered(img, region) {
    const candidate = toPageBBox(img, region);
    return renderedPageBBoxes.some((r) => overlapRatio(r, candidate) > 0.5);
  }

  function registerRenderedRegion(img, region) {
    renderedPageBBoxes.push(toPageBBox(img, region));
  }

  // ===== Job — tai + dich + ve overlay cho 1 anh (dung chung cho Queue) =====
  const state = { total: 0, done: 0, errors: 0 };
  // Luu loi chi tiet de nguoi dung bam nut xem lai (C4: "Loi - click xem"
  // - spec goc nghi cho 1 anh, o day gop thanh danh sach vi co nhieu anh).
  const errorLog = [];

  // ===== Option C: ngu canh nhan vat per-truyen =====
  // Dung ho so nhan vat 1 lan (sau vai trang) roi tiem gpt_config rieng cua
  // truyen vao cac call dich sau => dai tu nhat quan. Xem spec
  // 2026-08-09-per-series-character-context-design.md.
  const SeriesCtx = {
    _mem: null,
    _ensuredThisSession: false,
    _building: false,
    _storeKey(seriesId) {
      return `mot_series_ctx_v${CFG.CACHE_VERSION}_${seriesId}`;
    },
    async load(seriesId) {
      if (this._mem && this._mem.seriesId === seriesId) return this._mem;
      const key = this._storeKey(seriesId);
      const got = (await chrome.storage.local.get(key))[key];
      this._mem = got || { seriesId, sheet: '', path: null, srcAccum: [], pages: 0, built: false };
      this._mem.seriesId = seriesId;
      return this._mem;
    },
    async save() {
      if (!this._mem) return;
      await chrome.storage.local.set({ [this._storeKey(this._mem.seriesId)]: this._mem });
    },
    // Tra ve gpt_config path cua truyen neu da dung ho so (va dam bao file ton
    // tai tren backend 1 lan/phien); null neu chua dung.
    async resolvePath(st) {
      if (!st.built || !st.sheet) return null;
      if (!this._ensuredThisSession) {
        this._ensuredThisSession = true;
        const res = await sendMessageAsync({
          type: 'SET_SERIES_CONTEXT',
          payload: { series_id: st.seriesId, sheet: st.sheet },
        }).catch(() => null);
        if (res && res.ok && res.data && res.data.gpt_config_path) {
          st.path = res.data.gpt_config_path;
          await this.save();
        }
      }
      return st.path;
    },
    // Gom src cua trang vua dich; khi du CTX_MIN_PAGES trang + CTX_MIN_CHARS ky
    // tu thi goi backend dung ho so 1 lan (khoa _building chong goi trung).
    async accumulateAndMaybeBuild(st, result, targetLang) {
      const srcs = (result.regions || []).map((r) => r.src).filter(Boolean);
      if (srcs.length) {
        st.srcAccum.push(...srcs);
        st.pages += 1;
        await this.save();
      }
      const joined = st.srcAccum.join('\n');
      if (this._building || st.pages < CFG.CTX_MIN_PAGES || joined.length < CFG.CTX_MIN_CHARS) return;
      this._building = true;
      try {
        const res = await sendMessageAsync({
          type: 'BUILD_SERIES_CONTEXT',
          payload: { series_id: st.seriesId, text: joined, target_lang: targetLang },
        }).catch(() => null);
        if (res && res.ok && res.data && res.data.sheet) {
          st.sheet = res.data.sheet;
          st.path = res.data.gpt_config_path;
          st.built = true;
          await this.save();
          log('Da dung ho so nhan vat cho truyen', st.seriesId, '-', st.sheet.length, 'ky tu');
        }
      } finally {
        this._building = false;
      }
    },
  };

  async function translateAndRenderImage(img) {
    if (imgLayers.has(img)) return;
    const tStart = performance.now();
    try {
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
          if (seriesId) {
            st = await SeriesCtx.load(seriesId);
            gptConfigPath = await SeriesCtx.resolvePath(st);
          }
          result =
            img.naturalHeight > CFG.TILE_MAX_H
              ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight, img, gptConfigPath)
              : await ApiAdapter.translateImage(await buildStitchedBlob(img, blob), gptConfigPath);
          await Cache.set(hash, targetLang, engine, result);
          // Chua dung ho so => gom chu goc, du thi dung 1 lan cho truyen.
          if (seriesId && st && !st.built) {
            await SeriesCtx.accumulateAndMaybeBuild(st, result, targetLang);
          }
        }
        if (urlCacheable) await Cache.setUrlHash(url, hash);
      }
      // Loc bo vung chu da duoc anh TRUOC ve roi (qua ghep-bien muon dai
      // tren cua anh nay) - tranh ve trung 2 lan cung 1 noi dung (xem spec
      // 2026-07-23-cross-image-boundary-stitching-design.md muc 6).
      result.regions = result.regions.filter((r) => {
        // Case A (chu nhan manh giu nguyen: SFX/tieng cuoi) - prompt tra dst==src.
        // Bo render de GIU art goc. NHUNG chi bo khi: (1) dst rong, HOAC (2)
        // dst==src VA nguon co chu KHONG-Latin (CJK/hangul: SFX goc giu nguyen).
        // KHONG bo khi src la Latin (tranh xoa nham tu hop le/ten rieng model tra
        // trung - da tung lam sot tu). Xem gpt_config quy tac EMPHASIZED text.
        const _dst = (r.dst || '').trim();
        const _src = (r.src || '').trim();
        const _srcNonLatin = /[^ -ɏ\s\d\p{P}]/u.test(_src);
        if (!_dst) {
          if (DBG) console.log('[MOT-DBG] skip region: dst rong | src=', _src.slice(0, 30));
          return false;
        }
        if (_dst.toLowerCase() === _src.toLowerCase() && _srcNonLatin) {
          if (DBG) console.log('[MOT-DBG] skip region: giu-nguyen SFX CJK | src=', _src.slice(0, 30));
          return false;
        }
        if (isDuplicateOfRendered(img, r)) return false;
        // Chi dang ky vao registry chong-trung nhung vung NAM TRONG DAI BIEN da
        // muon cua anh ke tiep (y+h > chieu cao THAT cua anh) - tuc noi dung
        // THUOC anh ke tiep ma anh nay ve ho qua ghep-bien. Vung noi dung cua
        // CHINH anh (y+h <= naturalHeight) khong bao gio bi anh khac phat hien
        // lai trong webtoon xep doc, nen KHONG dang ky - neu dang ky, viewer
        // CHUYEN TRANG (chong cac anh len cung toa do) se so trung nham va xoa
        // cac vung dau trang sau (bug da xac nhan + fix 2026-08-03).
        if (r.y + r.h > img.naturalHeight) {
          registerRenderedRegion(img, r);
        }
        return true;
      });
      const busyFlags = await computeRegionComplexity(result.regions);
      result.regions.forEach((r, i) => {
        r.busy = busyFlags[i];
      });
      await OverlayRenderer.render(img, result.regions);
      // Ghi lai src da render de phat hien reader TAI DUNG <img> voi blob khac
      // (virtual list, vd MangaPlaza) -> khi src doi se dich lai (xem invalidateImg).
      img.__motRenderedSrc = img.currentSrc || img.src || '';
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
      if (DBG) console.log('[MOT-DBG] enqueue', (img.currentSrc || img.src || '').slice(0, 45), 'pending->', this._pending.length + 1);
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
      // Sap xep lai theo vi tri Y tren trang - KHONG dua vao thu tu
      // IntersectionObserver bao ve trong entries[], da xac nhan thuc te
      // (test that tren webtoons.com) KHONG dam bao dung thu tu trang khi
      // nhieu anh cung luc lot vao PREFETCH_MARGIN (200% man hinh): anh
      // 0030 tung xu ly TRUOC anh 0029 dung phia truoc no. Xu ly sai thu tu
      // pha vo gia dinh cua dedup chong ve trung giua anh lien ke (xem
      // renderedPageBBoxes/isDuplicateOfRendered - dua vao gia dinh anh
      // truoc luon dang ky TRUOC anh sau xu ly) va dich khong theo thu tu doc.
      this._pending.sort((a, b) => {
        const topA = a.getBoundingClientRect().top + window.scrollY;
        const topB = b.getBoundingClientRect().top + window.scrollY;
        return topA - topB;
      });
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
        // Hang doi vua rong VA eager mode dang bat -> bao hoan tat. Kiem tra
        // TRUOC khi goi _drain() lai (ben duoi) de tranh doc nham trang thai
        // sau khi _drain() co the da lay job moi ra khoi _pending.
        if (eagerModeActive && this._pending.length === 0 && this._active === 0) {
          showCompletionToast();
        }
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

  // Reader AO HOA (virtual list, vd MangaPlaza) TAI DUNG cung <img> cho trang
  // khac (doi blob src). Khi src doi tren 1 anh DA render, layer cu la cua noi
  // dung CU -> vo hieu (xoa layer + bo danh dau) roi dich lai noi dung moi.
  function invalidateImg(img) {
    const layer = imgLayers.get(img);
    if (layer) {
      _lastRect.delete(layer);
      layer.remove();
      imgLayers.delete(img);
    }
    Queue._queued.delete(img);
    delete img.__motRenderedSrc;
    if (autoStarted) Queue.enqueue(img);
  }

  function registerImage(img) {
    if (registeredImages.has(img)) return;
    const tryRegister = () => {
      if (registeredImages.has(img)) return;
      if (!ImageFinder.isCandidate(img)) return;
      registeredImages.add(img);
      state.total++;
      if (DBG) console.log('[MOT-DBG] register+', (img.currentSrc || img.src || '').slice(0, 45), '| eager=', eagerModeActive, 'autoStarted=', autoStarted);
      // Eager mode: bo qua IntersectionObserver, enqueue ngay lap tuc (xem
      // spec 2026-08-02-eager-webtoon-pretranslate-design.md muc 3). Nhanh
      // nay CHI kich hoat khi eagerModeActive true - nhanh else giu NGUYEN
      // hanh vi cu 100% (khong doi gi khi toggle OFF).
      if (autoStarted && eagerModeActive) {
        Queue.enqueue(img);
      } else if (intersectionObserver) {
        // Neu auto mode da chay roi (da kich hoat dich roi, anh nay moi xuat
        // hien sau, vd lazy-load) thi theo doi ngay; neu chua kich hoat thi
        // chi dang ky, se duoc observe hang loat luc kich hoat (xem startAutoMode()).
        intersectionObserver.observe(img);
      }
    };
    const onLoad = () => {
      // Anh DA render nhung src DOI (reader tai dung <img> cho trang khac) ->
      // dich lai noi dung moi (xem invalidateImg).
      const cur = img.currentSrc || img.src || '';
      if (img.__motRenderedSrc && cur && cur !== img.__motRenderedSrc) {
        invalidateImg(img);
      }
      tryRegister();
    };
    tryRegister(); // thu ngay - co the anh da tai xong that su tu dau
    // 'load' bat MOI LAN src doi va tai xong xong, KHONG CHI lan dau
    // ({ once: true } cu se bo lo lan site thay placeholder bang URL
    // that). isCandidate() da loai data: URI (xem ImageFinder), nen lan
    // dau thuong bi tu choi boi placeholder, phai doi 'load' lan tiep
    // theo (khi site gan src that vao) moi dang ky duoc. onLoad cung bat
    // truong hop reader tai dung <img> doi blob (virtual list).
    img.addEventListener('load', onLoad);
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

  // Tra ve URL anh THAT giau trong data-attribute (lazy-load), hoac null.
  // Thu theo thu tu: data-url (webtoon), data-src, data-original,
  // data-lazy-src. Chi nhan URL http(s) tuyet doi. Luu y: data-lazy-src ->
  // dataset.lazySrc (dataset tu camelCase hoa).
  function getLazyUrl(img) {
    const candidates = [
      img.dataset.url,
      img.dataset.src,
      img.dataset.original,
      img.dataset.lazySrc,
    ];
    for (const v of candidates) {
      if (v && (v.startsWith('http://') || v.startsWith('https://'))) return v;
    }
    return null;
  }

  // Ep tai truoc moi anh lazy-load: nhieu site (webtoon...) de <img> chua
  // cuon toi mang src placeholder, con URL that giau trong data-*. Copy URL
  // do vao src de trinh duyet tai ngay, khong can cuon. Anh tai xong -> 'load'
  // listener (da gan trong registerImage) chay lai tryRegister -> isCandidate
  // qua (co kich thuoc that) -> registerImage + eager enqueue. Xem spec
  // 2026-08-03-eager-force-load-lazy-images-design.md.
  function forceLoadLazyImages() {
    document.querySelectorAll('img').forEach((img) => {
      const u = getLazyUrl(img);
      if (u && img.src !== u) img.src = u;
    });
  }

  // ===== Hitomi: dich nen ca gallery (reader chuyen trang) =====
  // Xem spec 2026-08-03-hitomi-gallery-prefetch-design.md.
  function isHitomiReader() {
    return (
      /(^|\.)hitomi\.la$/.test(location.hostname) &&
      /\/reader\/\d+\.html/.test(location.pathname)
    );
  }

  // Option C: dinh danh "truyen" de khoa ho so nhan vat + file gpt_config
  // per-truyen. hitomi => gallery id (reader/<id>.html); site khac => host +
  // 2 doan path dau. Tra null neu khong dinh danh duoc => luong cu (khong ngu canh).
  function getSeriesId() {
    try {
      const h = location.hostname.replace(/^www\./, '');
      if (/(^|\.)hitomi\.la$/.test(h)) {
        const m = location.pathname.match(/\/reader\/(\d+)\.html/) || location.pathname.match(/-(\d+)\.html/);
        if (m) return 'hitomi-' + m[1];
      }
      const seg = location.pathname.split('/').filter(Boolean).slice(0, 2).join('-');
      const id = (h + (seg ? '-' + seg : '')).slice(0, 120);
      return id || null;
    } catch {
      return null;
    }
  }

  // Nho background chay ham MAIN-world doc galleryinfo + build URL. Tra ve
  // mang URL, hoac null neu khong phai gallery hitomi / hitomi doi cau truc.
  async function getHitomiGalleryUrls() {
    try {
      const res = await sendMessageAsync({ type: 'HITOMI_GALLERY_URLS' });
      return res && res.ok && Array.isArray(res.urls) ? res.urls : null;
    } catch (e) {
      return null;
    }
  }

  // Tai blob tu URL truc tiep (khong qua <img>). Mirror DUNG nhanh non-blob
  // cua ApiAdapter.downloadImageBlob de hash KHOP hash luc dieu huong (cache
  // HIT khi nguoi dung lat toi trang).
  async function downloadBlobFromUrl(url) {
    const res = await sendMessageAsync({ type: 'DOWNLOAD_IMAGE', url });
    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'Khong tai duoc anh: ' + url);
    }
    const rawBlob = base64ToBlob(res.base64, res.contentType);
    return await reencodeToPng(rawBlob);
  }

  // Toast tien trinh prefetch: 1 element cap nhat textContent, tai dung style
  // .mot-toast. Khi done == total -> doi text "xong" roi tu an sau 3s.
  let _prefetchToastEl = null;
  function updatePrefetchToast(done, total) {
    if (!_prefetchToastEl) {
      _prefetchToastEl = document.createElement('div');
      _prefetchToastEl.className = 'mot-toast';
      document.body.appendChild(_prefetchToastEl);
    }
    if (done < total) {
      _prefetchToastEl.textContent = `Đang dịch nền gallery: ${done}/${total}`;
    } else {
      _prefetchToastEl.textContent = `Đã dịch xong gallery ${done}/${total}`;
      const el = _prefetchToastEl;
      _prefetchToastEl = null;
      setTimeout(() => {
        el.classList.add('mot-toast-hide');
        setTimeout(() => el.remove(), 300);
      }, 3000);
    }
  }

  // Dich nen tuan tu tung URL vao cache (backend CONCURRENCY:1). Khong dung
  // toi man hinh/dieu huong. Loi 1 trang -> bo qua, tiep tuc.
  async function prefetchHitomiGallery(urls) {
    const targetLang = await getTargetLang();
    const engine = await getTranslatorEngine();
    // Option C: prefetch cung phai dung/tiem ho so nhan vat, neu khong cac trang
    // prefetch bi cache KHONG ngu canh -> khi xem la cache-hit, feature bi bo qua
    // hoan toan voi truyen prefetch (dung la case hitomi chinh). Chia se SeriesCtx
    // voi luong xem (translateAndRenderImage) qua singleton nen phoi hop nhat quan.
    const ctxOn = await getCharacterContext();
    const seriesId = ctxOn && targetLang === 'VIN' && engine !== 'deepl' ? getSeriesId() : null;
    const st = seriesId ? await SeriesCtx.load(seriesId) : null;
    let done = 0;
    // Pipeline: tai truoc blob cua trang KE TIEP trong luc backend dich trang
    // hien tai. Backend (~7s) >> tai anh (~3s) nen viec tai bi GIAU HOAN TOAN
    // trong luc dich -> throughput prefetch ~7s/trang thay vi ~10s (tai la
    // I/O, khong tranh GPU voi dich). Xem investigation 2026-08-08.
    let nextBlobP =
      urls.length > 0 ? downloadBlobFromUrl(urls[0]).catch(() => null) : Promise.resolve(null);
    for (let i = 0; i < urls.length; i++) {
      // A: NHUONG trang dang xem. Backend chi 1 executor - neu prefetch va
      // hang doi anh (dich trang dang xem de ve overlay) dap cung luc thi
      // trang dang xem bi ket sau prefetch (~22s thay vi ~12s). Tam dung
      // prefetch khi img-Queue con viec (xem bug tranh chap 2026-08-08).
      while (Queue._active > 0 || Queue._pending.length > 0) {
        await new Promise((r) => setTimeout(r, 300));
      }
      const url = urls[i];
      const blob = await nextBlobP;
      // Bat dau tai trang KE TIEP ngay bay gio -> chay song song voi phan dich
      // trang hien tai ben duoi (giau do tre tai).
      nextBlobP =
        i + 1 < urls.length ? downloadBlobFromUrl(urls[i + 1]).catch(() => null) : Promise.resolve(null);
      try {
        if (blob) {
          const hash = await Cache.hashBlob(blob);
          const cached = await Cache.get(hash, targetLang, engine);
          if (!cached) {
            const gptConfigPath = st ? await SeriesCtx.resolvePath(st) : null;
            const result = await ApiAdapter.translateImage(blob, gptConfigPath);
            await Cache.set(hash, targetLang, engine, result);
            if (st && !st.built) await SeriesCtx.accumulateAndMaybeBuild(st, result, targetLang);
          }
          await Cache.setUrlHash(url, hash);
        }
      } catch (e) {
        console.warn('[MOT] Prefetch loi 1 trang, bo qua:', url, e.message);
      }
      done++;
      updatePrefetchToast(done, urls.length);
    }
  }

  async function startAutoMode() {
    eagerModeActive = await getEagerTranslate();

    if (eagerModeActive) {
      // Reader chuyen trang (hitomi): dich nen CA GALLERY vao cache, khong di
      // chuyen man hinh (xem spec 2026-08-03-hitomi-gallery-prefetch-design.md).
      // Fire-and-forget, chay nen song song voi eager thuong; urls null (khong
      // phai gallery hitomi / hitomi doi cau truc) -> khong lam gi dac biet.
      if (isHitomiReader()) {
        getHitomiGalleryUrls().then((urls) => {
          if (urls && urls.length) {
            // B: bat dau prefetch tu TRANG HIEN TAI (theo hash #N) di toi roi
            // vong lai dau - dich truoc dung cac trang sap doc, khong phi cong
            // vao trang da qua (xem bug tranh chap 2026-08-08).
            const cur = parseInt(location.hash.replace('#', ''), 10) || 1;
            const start = Math.min(Math.max(cur - 1, 0), urls.length - 1);
            const ordered = [...urls.slice(start), ...urls.slice(0, start)];
            prefetchHitomiGallery(ordered);
          }
        });
      }
      // Ep tai truoc moi anh lazy-load co URL that trong data-* (webtoon...)
      // de bat duoc CA CHUONG ma khong can nguoi dung cuon. Anh tai xong se
      // tu register + enqueue qua 'load' listener (xem forceLoadLazyImages()).
      forceLoadLazyImages();
      // Bo qua IntersectionObserver hoan toan - enqueue truc tiep TOAN BO
      // anh da biet, dua vao Queue._pending sort theo vi tri Y (xem
      // Queue._drain()) de van xu ly theo dung thu tu doc dau tien.
      registeredImages.forEach((img) => Queue.enqueue(img));
      log('Auto mode (eager) da bat dau. Dang ep tai + dich toan bo anh ca chuong, khong doi cuon toi...');
      dbgScan('afterStart-eager');
      return;
    }

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
    dbgScan('afterStart-c3');
  }

  let autoStarted = false;
  let eagerModeActive = false; // set boi startAutoMode() - true neu Task 1
  // checkbox dang bat LUC bam nut dich; quyet dinh registerImage() enqueue
  // truc tiep hay giao cho IntersectionObserver (xem startAutoMode() ben duoi).

  // Toast goc duoi-phai, tu bien mat sau 3s - chi goi tu Queue._drain() khi
  // eager mode dang bat VA hang doi vua rong (xem spec muc 4). Khong thay
  // the showErrorSummary() - chi bao tong so, khong liet ke tung loi.
  function showCompletionToast() {
    const errSuffix = state.errors > 0 ? ` (${state.errors} lỗi)` : '';
    const toast = document.createElement('div');
    toast.className = 'mot-toast';
    toast.textContent = `Đã dịch xong ${state.done}/${state.total} ảnh${errSuffix}`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('mot-toast-hide');
      setTimeout(() => toast.remove(), 300); // khop voi transition 0.3s trong CSS
    }, 3000);
  }

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
    startAutoMode().catch((err) => {
      console.error('[MOT] Khong khoi dong duoc auto mode:', err);
      autoStarted = false; // cho phep bam lai de thu lai
    });
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
    } else if (key === 'g') {
      // DEBUG (tam thoi): dump trang thai phat hien/queue/scroll ra console.
      e.preventDefault();
      dbgScan('manual');
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
