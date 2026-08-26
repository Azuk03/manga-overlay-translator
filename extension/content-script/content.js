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
    // Do phan giai detect chu. KHONG don dieu theo kich thuoc chu: chu NHO nen-toi
    // (page 005) bat o ~2048 nhung sot o 3072; chu TO/dam (page 012 "IF I TEACH")
    // sot o 1536-2048 nhung bat o 1024/3072. Da do mịn: 2400 la DIEM NGOT DUY NHAT
    // bat duoc CA hai on dinh (005=2/2, 012 ok - 3/3 lan). Nen dung 2400 (khong
    // can multi-scale/2-pass). VRAM ~4.3MP < 3072 nen an toan 4GB. Backend nhan
    // detection_size theo request (khong can rebuild).
    DETECTION_SIZE: 2400,
    MIN_NW: 400,
    MIN_NH: 400,
    MIN_DISPLAY_RATIO: 0.3,
    // (Da bo TIMEOUT_MS khoi day: no la CODE CHET - khai bao nhung khong dong
    // nao doc. Timeout that su nam o background.js, noi duy nhat goi fetch. Giu
    // lai mot ban sao vo tac dung kem ghi chu "phai khop" la cai bay: nguoi sua
    // sau rat de chinh dung cai khong co hieu luc roi tuong da doi timeout.
    // Toan bo so lieu do duoc da chuyen sang canh hang so that.)
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
    CACHE_VERSION: 24, // GO edge-gate (phu thuoc main-detect nondeterministic -> miss bong bong vat-bien): crop-bien chay LUON moi seam lien mach (nhu lan test tot). Giu hop nhat (bo toggle)
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
    // Ghep bien anh lien ke: dai BOUNDARY_BORROW_HEIGHT px CUOI anh hien tai
    // + dai cung do DAU anh KE TIEP duoc ghep thanh 1 anh NHO RIENG BIET va
    // detect DOC LAP voi anh chinh (KHONG con noi vao anh chinh truoc khi
    // detect nhu truoc - lam vay se co hep do phan giai CA anh chinh, xem
    // spec 2026-08-12-overlay-safe-layout-and-boundary-detection-design.md).
    // Bong bong BI CAT nam NGAY tai seam (2 nua sat duong noi) nen chi can
    // muon it. Da do thuc te (test_synth: 15 ca vat-bien tong hop): borrow
    // 500/300/200/150 deu bat y het (14/15). 200px giu du margin ma GIAM ~60%
    // vung chong lan bi re-detect/re-OCR -> bot "detect/dich lap" backend
    // (probe + crop khong con quet lai bong bong nam SAU trong trang, vo can
    // voi seam) va probe nhanh hon. Xem ham detectBoundaryRegions().
    BOUNDARY_BORROW_HEIGHT: 200,
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
    // Ghep-bien gio HOP NHAT (luon bat, auto-gate) nen khoa cache khong con
    // phu thuoc trang thai toggle - bo co s0/s1 (CACHE_VERSION da bump).
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
    // URL duoc CHUAN HOA truoc khi lam khoa: mot so CDN (hitomi) nhung 1 doan
    // unix timestamp quay vong ~28h vao path, khien khoa theo URL tho chet sach
    // sau moi lan quay vong (do that: 1963 khoa tan ra >10 moc, moc moi nhat
    // chi 32.7%) -> fast path khong bao gio trung, moi trang da dich van phai
    // tai lai anh + bam (~2-3.4s). Xem url-cache-key.js va tests/.
    _urlKey(url) {
      return `mot_urlhash_v${CFG.CACHE_VERSION}_${motNormalizeUrlForCacheKey(url)}`;
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

  // Chuyen chi muc URL->hash cu (khoa theo URL THO) sang dang chuan hoa.
  // KHONG phai chi don dep: vi chuan hoa bo dung doan timestamp da lam chung
  // chet, moi khoa cu duoc HOI SINH thanh 1 khoa dung -> ca kho anh da dich
  // tu truoc lai vao duoc fast path ma khong phai tai lai byte nao.
  // Chay 1 lan (co co danh dau). Chay lai vo hai: motNormalizeUrlForCacheKey()
  // idempotent (co test) va khoa cu/moi dung chung tien to nen khong the phan
  // biet - dieu kien `newKey === oldKey` bo qua khoa da chuan hoa.
  const URLHASH_PREFIX = `mot_urlhash_v${CFG.CACHE_VERSION}_`;
  const URLHASH_MIGRATED_FLAG = `mot_urlhash_normalized_v${CFG.CACHE_VERSION}`;

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
  function decodeBlobToCanvas(blob) {
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
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error('Khong giai ma duoc anh tai ve (dinh dang la?)'));
      };
      img.src = objUrl;
    });
  }

  function reencodeToPng(blob) {
    return decodeBlobToCanvas(blob).then(
      (canvas) =>
        new Promise((resolve, reject) => {
          canvas.toBlob((out) => {
            if (out) resolve(out);
            else reject(new Error('Khong re-encode duoc anh sang PNG'));
          }, 'image/png');
        })
    );
  }

  // Giai ma blob thanh ImageBitmap de cat/ghep bang canvas.
  //
  // PHAI di qua ham nay, KHONG goi thang createImageBitmap(blob): tu khi anh
  // duoc gui THANG byte goc (xem image-format.js) thi blob toi day co the la
  // AVIF, ma theo ghi chu v0.33 - loi that da gap tren Coc Coc - mot so ban
  // Chromium co codec AVIF cho <img> nhung KHONG co cho createImageBitmap()
  // ("InvalidStateError: The source image could not be decoded"). Truoc day moi
  // blob deu da la PNG nen khong the gap; gio thi co the. Duong lui dung lai
  // dung <img> + canvas - cach von da chay on dinh cho ca AVIF.
  async function decodeBlobToBitmap(blob) {
    try {
      return await createImageBitmap(blob);
    } catch (err) {
      log('createImageBitmap that bai, giai ma lai bang <img>+canvas:', err && err.message);
      return await createImageBitmap(await decodeBlobToCanvas(blob));
    }
  }

  console.log('[MOT] CFG/ImageFinder/Cache/helpers da nap xong (Task 6).');

  // Giai ma chuoi base64 (nhan tu background.js qua chrome.runtime message)
  // thanh Blob that. Dung base64 thay vi ArrayBuffer vi ArrayBuffer KHONG
  // duoc bao toan dang tin cay qua chrome.runtime.sendMessage/sendResponse
  // trong Manifest V3 - da xac nhan bang test that (res.arrayBuffer den noi
  // nay chi con la {} rong, Blob ket qua chi co 15 byte cua chuoi
  // "[object Object]" bi stringify nham thay vi du lieu nhi phan that).
  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function base64ToBlob(base64, contentType) {
    return new Blob([base64ToBytes(base64)], { type: contentType });
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

  // Blob nao la BYTE GOC gui thang (khong qua nen lai PNG). Dung WeakSet chu
  // khong doi chu ky ham tra ve, de moi noi goi downloadImageBlob() giu nguyen.
  // translateImage() tra cuu o day de biet co duoc phep thu lai bang duong nen
  // PNG khi backend tu choi (vd nguoi dung cap nhat extension nhung chua build
  // lai image nen chua co pillow-avif-plugin).
  const passthroughBlobs = new WeakSet();

  // NOI DUY NHAT tai anh tu URL. Truoc day logic nay bi CHEP LAM DOI (mot ban
  // trong ApiAdapter.downloadImageBlob, mot ban trong downloadBlobFromUrl cho
  // prefetch) kem mot comment dan "phai mirror dung nhanh non-blob de hash
  // KHOP" - dung loai rui ro ma viec gop lai nay xoa han: hai ban lech nhau la
  // hash lech nhau, tuc prefetch ghi vao mot khoa ma luc doc khong bao gio trung.
  async function downloadBlobFromUrl(url) {
    const res = await sendMessageAsync({ type: 'DOWNLOAD_IMAGE', url });
    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'Khong tai duoc anh: ' + url);
    }
    const bytes = base64ToBytes(res.base64);
    if (motShouldReencodeForBackend(res.contentType, bytes)) {
      // Duong cu: backend khong doc duoc dinh dang nay, hoac anh co EXIF (huong
      // xoay co the lech giua trinh duyet va Pillow) - xem image-format.js.
      return await reencodeToPng(new Blob([bytes], { type: res.contentType }));
    }
    const blob = new Blob([bytes], { type: res.contentType });
    passthroughBlobs.add(blob);
    return blob;
  }

  // Cua so thoai gan nhat cua RIENG tab nay. Giu o client (khong phai backend)
  // vi do that cho thay tron ngu canh giua cac truyen la tai hoa AM THAM: diem
  // nhat quan van dep nhung toan bo register bi sai (mot canh tiem thuoc hien
  // dai bi dich bang giong cung dinh ta-nguoi). Nguoi dung chay toi 10 tab dong
  // thoi nen state dung chung o backend la dung kich ban do.
  const dialogueWindow = [];

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
      return await downloadBlobFromUrl(src);
    },

    blobToDataURL(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },

    // detectOnly: chi chay detect + OCR (translator 'none' - KHONG goi GPT,
    // KHONG inpaint) de lay TOA DO + text goc cac vung. Rat re (chi model
    // local). Dung cho gate detect-first cua ghep-bien: biet truoc co vung
    // vat-bien khong ma khong ton 1 luot GPT (xem detectBoundaryRegions()).
    async translateImage(blob, detectOnly = false) {
      const targetLang = await getTargetLang();
      const engine = detectOnly ? 'none' : await getTranslatorEngine();
      const translatorConfig = {
        translator: engine,
        target_lang: targetLang,
      };
      // gpt_config (prompt La-tinh hoa ten rieng) chi co tac dung voi engine
      // ho GPT (chatgpt/gemini - ca 2 deu ke thua CommonGPTTranslator ben
      // backend, doc chung 1 co che prompt qua field gpt_config), KHONG co
      // tac dung voi deepl (kien truc khac han, khong doc gpt_config - xem
      // spec 2026-07-23-translator-engine-picker-design.md muc 3/6).
      if (!detectOnly && targetLang === 'VIN' && engine !== 'deepl') {
        translatorConfig.gpt_config = CFG.GPT_CONFIG_PATH;
      }
      const config = {
        detector: { detection_size: CFG.DETECTION_SIZE },
        translator: translatorConfig,
        render: { renderer: 'none' },
      };
      // Inpaint chi phuc vu render (xoa chu goc). Probe detect-only khong dung
      // ket qua inpaint - no chi doc TOA DO vung - nen phai tat han.
      //
      // PHAI ghi ro 'none', KHONG duoc bo trong khoa nay: bo trong thi backend
      // dung MAC DINH cua no, ma mac dinh la `lama_large` chu khong phai
      // CFG.INPAINTER. Do that tren log mot phien webtoon 180 luot goi: 41 luot
      // chay [LamaLargeInpainter] - dung bang so luot probe - inpaint xong roi
      // vut di. Ton 10,3s GPU, nhung dieu dang lo hon la lama_large ngon VRAM
      // hon lama_mpe (~3,7GB vs ~3,4GB) tren card 4GB.
      // 'none' khong lam vo to_json.py: NoneInpainter van gan ctx.img_inpainted
      // (copy anh + to trang vung mask), chi khong chay model.
      config.inpainter = detectOnly
        ? { inpainter: 'none' }
        : { inpainter: CFG.INPAINTER, inpainting_size: CFG.INPAINTING_SIZE };
      const send = async (b) => {
        const payload = { image: await this.blobToDataURL(b), config };
        // detectOnly chay translator 'none' (khong goi GPT) nen ngu canh vo nghia.
        if (!detectOnly) {
          const ctx = motContextPayload(dialogueWindow);
          if (ctx.length) payload.context = ctx;
        }
        return await sendMessageAsync({ type: 'TRANSLATE', body: JSON.stringify(payload) });
      };

      let res = await send(blob);
      if ((!res || !res.ok) && passthroughBlobs.has(blob)) {
        // Blob nay la byte goc gui thang. Backend tu choi co the vi no CHUA co
        // pillow-avif-plugin (nguoi dung cap nhat extension nhung chua build lai
        // image). Nen lai thanh PNG va thu dung MOT lan - duong nen PNG la thu
        // von da chay on dinh tu truoc, nen buoc lui nay luon an toan.
        log('Backend tu choi byte goc, thu lai bang duong nen PNG:', (res && res.error) || '');
        try {
          res = await send(await reencodeToPng(blob));
        } catch (err) {
          throw new Error('Backend tu choi ca byte goc lan ban nen PNG: ' + err.message);
        }
      }
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
      let boundaryRegions = [];
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        const result = await this.translateImage(tile.blob);
        for (const r of result.regions) {
          allRegions.push({ ...r, y: r.y + tile.yOffset });
        }
        // Chi lat CUOI CUNG moi thuc su giap ranh gioi voi anh ke tiep tren
        // trang - cac lat truoc da co TILE_OVERLAP xu ly rieng (xem spec
        // 2026-07-23-cross-image-boundary-stitching-design.md muc 8). Detect
        // bien RIENG (khong con noi vao blob cua lat) - xem
        // detectBoundaryRegions(); tra ve toa do da o khong gian ANH GOC
        // (dung naturalH thuc, khong phai kich thuoc lat) nen cong thang
        // vao allRegions, khong can + tile.yOffset. KHONG gop truc tiep vao
        // allRegions o day - dedupeRegions(allRegions) ben duoi dung IoU,
        // chi dung cho vung CUNG ty le (giua 2 lat chong lan); vung boundary
        // detect o ty le KHAC (crop rieng) can mergeBoundaryRegions
        // (containment) tach rieng sau khi dedupeRegions da chay xong.
        if (i === tiles.length - 1) {
          boundaryRegions = await detectBoundaryRegions(img, tile.blob);
        }
      }
      return { regions: mergeBoundaryRegions(dedupeRegions(allRegions), boundaryRegions) };
    },
  };

  // Copy tu manga-overlay-translator.user.js dong 726-772
  async function sliceImageIntoTiles(blob, naturalW, naturalH) {
    const bitmap = await decodeBlobToBitmap(blob);
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
  // Trang thai "dung yen" cua vong lap rAF ben duoi. Khai bao O DAY (truoc moi
  // ham cham vao no) chu khong phai canh repositionLoop: scheduleReposition()
  // duoc dang ky lam listener ngay ben duoi, doc mot bien `let` khai bao sau no
  // la mot loi TDZ cho san neu sau nay co ai goi ham nay som hon.
  let _idleFrames = 0;
  let _frameTick = 0;

  let _reposScheduled = false;
  function scheduleReposition() {
    _idleFrames = 0; // co cuon/resize that -> trang dang dong, chay du toc do
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
  window.addEventListener(
    'scroll',
    (e) => {
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

  // (e) HA TAN SO KHI NGUOI DUNG DUNG YEN. Doc getBoundingClientRect() cua moi
  // layer o MOI frame la mot phep do lien tuc khong bao gio nghi: no bat CPU
  // lam viec ca khi trang dung im. Tren chinh may nay (laptop RTX 3050 Ti 4GB)
  // dieu do khong vo hai - CPU nong lam GPU bi throttle, tuc backend dich CHAM DI.
  //
  // Nhung KHONG duoc ha tan so mot cach mu quang: vong lap nay sinh ra chinh vi
  // reader kieu MangaPlaza di chuyen trang bang CSS transform, thu KHONG phat
  // su kien scroll - ha xuong 10 lan/giay se lam overlay tre thay ro dung luc
  // lat trang. Nen dieu kien la: chi ha khi da mot luc KHONG co gi nhuc nhich,
  // VA bat ky dau hieu nao cho thay nguoi dung vua tuong tac deu keo tan so len
  // lai ngay lap tuc (xem wakeReposition). Trang dung yen thi khong co gi de
  // tre; trang dang chuyen dong thi luon chay du toc do.
  const IDLE_AFTER_FRAMES = 60; // ~1s khong doi gi
  const IDLE_CHECK_EVERY = 6; // sau do chi do lai moi 6 frame
  // (_idleFrames/_frameTick khai bao o tren, canh scheduleReposition)

  function repositionLoop() {
    _rafId = null;
    if (imgLayers.size === 0) {
      _idleFrames = 0;
      return; // khong con overlay -> dung han
    }
    _frameTick++;
    if (_idleFrames >= IDLE_AFTER_FRAMES && _frameTick % IDLE_CHECK_EVERY !== 0) {
      if (!document.hidden) _rafId = requestAnimationFrame(repositionLoop);
      return;
    }
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
    if (updates.length > 0) _idleFrames = 0;
    else _idleFrames++;
    if (!document.hidden) _rafId = requestAnimationFrame(repositionLoop);
  }
  function startRepositionLoop() {
    if (_rafId == null && !document.hidden && imgLayers.size > 0) {
      _rafId = requestAnimationFrame(repositionLoop);
    }
  }

  // Bat ky dau hieu nao cho thay nguoi dung vua tuong tac -> keo tan so do vi
  // tri len lai ngay. Day la thu giu cho viec ha tan so o tren luon an toan:
  // chuyen dong bang CSS transform (thu khong phat 'scroll') gan nhu luon di
  // sau mot thao tac cua nguoi dung - bat cac su kien do la bat duoc thoi diem
  // BAT DAU chuyen dong, khong phai doi den luc do lai moi phat hien.
  function wakeReposition() {
    // Content script chay tren MOI trang, ke ca trang chua bao gio bam dich -
    // thoat ngay khi khong co overlay nao de 4 listener duoi day thuc su khong
    // ton gi tren nhung trang do.
    if (imgLayers.size === 0) return;
    _idleFrames = 0;
    startRepositionLoop();
  }
  for (const evt of ['wheel', 'keydown', 'pointerdown', 'touchstart']) {
    window.addEventListener(evt, wakeReposition, { passive: true, capture: true });
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

    // Doc chu THAT dang hien trong DOM, khong nhan qua tham so: tu khi ban dich
    // duoc dua len HOA theo chu goc (xem text-case.js), chuoi HIEN THI khac
    // chuoi trong r.dst. Do bang chuoi cu se ra co chu qua lon vi chu HOA RONG
    // HON - chu se tran khung. Doc thang tu DOM thi hai ben khong the lech nhau.
    _fitTextboxFont(textbox) {
      const boxW = textbox.clientWidth * CFG.FIT_SAFETY;
      const boxH = textbox.clientHeight * CFG.FIT_SAFETY;
      if (boxW <= 0 || boxH <= 0) return;
      const textEl = textbox.querySelector('.mot-text');
      const text = textEl.textContent || '';
      const size = this._fitFontSize(text, boxW, boxH);
      textEl.style.fontSize = size + 'px';
      if (size <= CFG.FONT_MIN) {
        const h = this._measureWrappedHeight(this._measureCanvas.getContext('2d'), text, size, boxW);
        textEl.classList.toggle('mot-overflow', h > boxH);
      }
    },

    // Gioi han an toan de nong khung: voi moi CAP vung "doi dien" nhau (bbox
    // GOC chong lan theo TRUC KIA - tuc la hang xom that su ben canh/tren-
    // duoi, khong phai o goc xa), ranh gioi dung chung la DIEM GIUA 2 mep
    // GOC doi dien - ca 2 phia deu tinh ra CUNG 1 duong ranh gioi nay (du
    // tinh tu vung nao truoc), nen 2 khung da kep KHONG BAO GIO cheo nhau,
    // bat ke vung kia muon nong to den dau. (Ban dau tung thu cach tinh
    // "khoang cach toi mep hang xom" tu MOT PHIA - SAI: ca 2 vung co the
    // doc lap tin rang chung duoc chiem TRON khoang trong giua, van de len
    // nhau - da kiem chung that bang du lieu detect that, xem
    // fixtures/verify_safe_bounds.js va spec 2026-08-12.)
    _computeSafeBounds(regions) {
      const MARGIN = 4; // px trong khong gian anh goc (naturalWidth/Height)
      return regions.map((r, i) => {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        let maxLeft = Infinity;
        let maxRight = Infinity;
        let maxUp = Infinity;
        let maxDown = Infinity;
        regions.forEach((other, j) => {
          if (i === j) return;
          const overlapsY = other.y < r.y + r.h && other.y + other.h > r.y;
          const overlapsX = other.x < r.x + r.w && other.x + other.w > r.x;
          if (overlapsY) {
            if (other.x >= r.x + r.w) {
              const mid = (r.x + r.w + other.x) / 2;
              maxRight = Math.min(maxRight, mid - cx - MARGIN);
            } else if (r.x >= other.x + other.w) {
              const mid = (other.x + other.w + r.x) / 2;
              maxLeft = Math.min(maxLeft, cx - mid - MARGIN);
            } else {
              // Both axes overlap: genuine overlap, constrain to no horizontal growth
              maxLeft = Math.min(maxLeft, 0);
              maxRight = Math.min(maxRight, 0);
            }
          }
          if (overlapsX) {
            if (other.y >= r.y + r.h) {
              const mid = (r.y + r.h + other.y) / 2;
              maxDown = Math.min(maxDown, mid - cy - MARGIN);
            } else if (r.y >= other.y + other.h) {
              const mid = (other.y + other.h + r.y) / 2;
              maxUp = Math.min(maxUp, cy - mid - MARGIN);
            } else {
              // Both axes overlap: genuine overlap, constrain to no vertical growth
              maxUp = Math.min(maxUp, 0);
              maxDown = Math.min(maxDown, 0);
            }
          }
        });
        return {
          maxHalfW: Math.max(r.w / 2, Math.min(maxLeft, maxRight)),
          maxHalfH: Math.max(r.h / 2, Math.min(maxUp, maxDown)),
        };
      });
    },

    // Chu Nhat goc thuong la cot doc HEP (vd rong 14px, cao 339px). Chu dich
    // tieng Viet luon ve NGANG (khong co field "vertical" trong API - xem
    // README.md), neu giu nguyen ti le hep-cao nay thi chu Viet bi nhoi vao
    // cot hep ~1 ky tu/dong, khong doc noi. Fix: "dinh hinh lai" thanh khung
    // rong hon CHI DE DAT CHU (khung nay TRONG SUOT, khong dung de che chu
    // goc - viec che chu la cua anh inpaint, xem render()). Han che do
    // "phinh ngang" (TARGET_ASPECT thap + gioi han max width) de giam
    // chong lan sang cot ben canh khi trang qua day dac. `bounds` (tu
    // _computeSafeBounds, optional) kep them theo hang xom that - khong
    // bao gio nong vuot qua gioi han nay du TARGET_ASPECT/3.5x muon nhieu
    // hon. Khi bi kep hep lai theo be rong, chieu cao duoc tinh lai theo
    // DIEN TICH da dinh hinh (khong phai dien tich bbox goc) de tan dung
    // toi da khong gian con lai, roi moi kep tiep theo chieu cao neu can.
    _reshapeForHorizontalText(r, bounds) {
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
      if (bounds) {
        const maxW = bounds.maxHalfW * 2;
        const maxH = bounds.maxHalfH * 2;
        if (w > maxW) {
          h = Math.min((w * h) / maxW, maxH);
          w = maxW;
        } else if (h > maxH) {
          // Nhanh nay khong the xay ra tren thuc te (voi bao dam maxHalfH >=
          // r.h/2 va cong thuc nong bao toan dien tich, h truoc-clamp o day
          // khong bao gio vuot qua maxH - da xac nhan trong final review) -
          // giu lai lam bao ve phong thu neu cong thuc nong sau nay doi.
          w = Math.min((w * h) / maxH, maxW);
          h = maxH;
        }
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
      const safeBounds = this._computeSafeBounds(regions);
      regions.forEach((r, i) => {
        const eff = this._reshapeForHorizontalText(r, safeBounds[i]);
        const padW = eff.w * CFG.TEXTBOX_PAD;
        const padH = eff.h * CFG.TEXTBOX_PAD;
        const tx = Math.max(0, eff.x - padW / 2);
        const ty = Math.max(0, eff.y - padH / 2);
        const tw = Math.min(naturalW - tx, eff.w + padW);
        // Khong clamp chieu cao khi vung THAT SU vuot qua day anh (vd tu
        // detectBoundaryRegions() - toa do co the > naturalH, xem ham do) -
        // Math.min(naturalH - ty, ...) se ra AM trong truong hop nay, thanh
        // CSS height khong hop le (bi bo qua, khung sup ve height:auto).
        // .mot-layer khong co overflow:hidden nen khung khong-clamp van ve
        // dung, giong ly do .mot-bg o PASS 1 cung khong clamp (xem tren).
        const th = eff.y + eff.h > naturalH ? eff.h + padH : Math.min(naturalH - ty, eff.h + padH);

        // Phan khung da nong VUOT QUA bbox goc (khong con nam gon trong
        // vung anh da inpaint that - xem PASS 1) khong co nen inpaint che -
        // phu them nen trang mo (giong .mot-busy) bat ke r.busy hay khong,
        // tranh chu/tranh raw lo ra quanh chu dich. Do dien tich PHAN KHUNG
        // NAM NGOAI bbox goc so voi tong dien tich khung (khong phai so
        // sanh eff.w*eff.h > r.w*r.h nhu ban dau - _reshapeForHorizontalText
        // BAO TOAN dien tich va safe-bounds chi CO THE thu hep them, nen
        // eff.w*eff.h khong bao gio > r.w*r.h => phep so sanh cu la no-op,
        // "grew" khong bao gio true; da xac nhan la loi trong final review,
        // xem erratum trong spec 2026-08-12-overlay-safe-layout-and-boundary-
        // detection-design.md). Nguong 10%: du nho de cac lan nong nhe (chu
        // khong-CJK) khong tu nhien co nen, du lon de bat dung truong hop
        // CJK doc bi nong ngang manh.
        const interW = Math.max(0, Math.min(eff.x + eff.w, r.x + r.w) - Math.max(eff.x, r.x));
        const interH = Math.max(0, Math.min(eff.y + eff.h, r.y + r.h) - Math.max(eff.y, r.y));
        const grew = eff.w * eff.h - interW * interH > eff.w * eff.h * 0.1;
        const textbox = document.createElement('div');
        textbox.className = 'mot-textbox' + (r.busy || grew ? ' mot-busy' : '');
        textbox.style.left = (tx / naturalW) * 100 + '%';
        textbox.style.top = (ty / naturalH) * 100 + '%';
        textbox.style.width = (tw / naturalW) * 100 + '%';
        textbox.style.height = (th / naturalH) * 100 + '%';

        const text = document.createElement('span');
        text.className = 'mot-text';
        // Bam theo chu goc: goc ALL-CAPS (OCR truyen tranh) thi ban dich cung
        // ALL-CAPS. Chi doi luc HIEN THI - r.dst va cache giu nguyen van model
        // tra ve. Xem text-case.js.
        text.textContent = motMatchSourceCase(r.src, r.dst);
        textbox.appendChild(text);

        // C4: bam vao 1 khung chu de xem chu goc (vd doi chieu ban dich) -
        // bam lai de tro ve ban dich. Chi bat khi co chu goc that su.
        if (r.src) {
          textbox.title = 'Bấm để xem chữ gốc';
          let showingSrc = false;
          textbox.addEventListener('click', () => {
            showingSrc = !showingSrc;
            text.textContent = showingSrc ? r.src : motMatchSourceCase(r.src, r.dst);
            textbox.title = showingSrc ? 'Bấm để xem bản dịch' : 'Bấm để xem chữ gốc';
            this._fitTextboxFont(textbox);
          });
        }

        layer.appendChild(textbox);
        textboxes.push(textbox);
      });

      // Fit font sau khi da noi vao DOM (can kich thuoc px thuc te).
      requestAnimationFrame(() => {
        textboxes.forEach((box) => this._fitTextboxFont(box));
      });

      // Anh doi kich thuoc hien thi (zoom/resize/site tu doi layout) - vua
      // phai tinh lai VI TRI/KICH THUOC layer (khong con tu dong bam theo
      // <img> nhu cach boc <span> cu, vi layer gio o ngoai body), vua phai
      // fit lai FONT (do dai dong chu thay doi theo kich thuoc px moi).
      const ro = new ResizeObserver(() => {
        positionLayer(img, layer);
        textboxes.forEach((box) => this._fitTextboxFont(box));
      });
      ro.observe(img);
      // Giu tham chieu de con NGAT duoc. Truoc day `ro` chi la bien cuc bo cua
      // render(), khong ai giu -> khong the disconnect() -> moi anh da dich de
      // lai vinh vien mot ResizeObserver dang quan sat mot <img> co the da roi
      // khoi DOM (do that: 263 .mot-layer con song cho 13 <img>). Xem releaseImg().
      layer.__motRo = ro;

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
    const bitmap = await decodeBlobToBitmap(fullBlob);
    const h = Math.min(stripHeightPx, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, bitmap.width, h, 0, 0, bitmap.width, h);
    bitmap.close?.();
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  // Detect DOC LAP vung giap ranh: cat rieng [BOUNDARY_BORROW_HEIGHT px CUOI
  // cua anh hien tai] + [BOUNDARY_BORROW_HEIGHT px DAU cua anh ke tiep]
  // thanh 1 anh NHO, gui backend detect+dich RIENG (KHONG con noi vao anh
  // chinh - anh chinh detect o kich thuoc goc, khong bi co do phan giai).
  // Tra ve mang region ĐA quy doi toa do ve khong gian anh hien tai (co the
  // vuot qua naturalHeight cua no - da duoc render() ho tro tu truoc, xem
  // spec 2026-07-23-cross-image-boundary-stitching-design.md muc render
  // khong clamp 100%). Khong bat/khong co anh ke/loi bat ky buoc nao ->
  // tra ve [] êm xuoi, khong chan render anh chinh.
  async function detectBoundaryRegions(img, blob) {
    const nextImg = findNextSiblingImage(img);
    if (!nextImg) {
      log('Ghep-bien: khong co anh ke tiep, bo qua.');
      return [];
    }

    let stripBlob;
    try {
      stripBlob = await getStripFromNextImage(nextImg, CFG.BOUNDARY_BORROW_HEIGHT);
    } catch (err) {
      log('Ghep-bien: loi tai dai anh ke tiep, bo qua.', err);
      return [];
    }
    if (!stripBlob) {
      log('Ghep-bien: khong lay duoc dai anh ke tiep, bo qua.');
      return [];
    }

    let cropBlob;
    let ownStripH;
    try {
      const [currentBitmap, stripBitmap] = await Promise.all([
        decodeBlobToBitmap(blob),
        decodeBlobToBitmap(stripBlob),
      ]);
      ownStripH = Math.min(CFG.BOUNDARY_BORROW_HEIGHT, currentBitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = currentBitmap.width;
      canvas.height = ownStripH + stripBitmap.height;
      const ctx = canvas.getContext('2d');
      // Dai CUOI cua anh hien tai (khong phai toan bo anh).
      ctx.drawImage(
        currentBitmap,
        0, currentBitmap.height - ownStripH, currentBitmap.width, ownStripH,
        0, 0, currentBitmap.width, ownStripH
      );
      ctx.drawImage(stripBitmap, 0, ownStripH);
      currentBitmap.close?.();
      stripBitmap.close?.();
      cropBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } catch (err) {
      log('Ghep-bien: loi dung anh crop bien, bo qua.', err);
      return [];
    }
    if (!cropBlob) {
      log('Ghep-bien: khong dung duoc anh crop bien, bo qua.');
      return [];
    }

    // Detect-first (zero-loss): chay DETECT-ONLY (translator 'none' - KHONG
    // GPT, chi model local) tren crop TRUOC. Crop chua NGUYEN bong bong da
    // ghep nen detection dang tin (khong phai sliver o mep anh chinh). Neu
    // KHONG co vung VAT QUA ranh gioi (y < ownStripH < y+h) -> khong co gi de
    // ghep -> tra [] ma KHONG ton 1 luot GPT. ~92% seam roi vao day. Da do
    // thuc te (test_detectfirst + test_synth: 27 co hoi vat-bien, gate 'none'
    // bat 100% vung ma chatgpt bat, 0 sot; on dinh qua 6 lan lap). Detect-only
    // dung CUNG detector always-run van dung de tim vat-bien -> khong the thua.
    let probeRegions;
    try {
      probeRegions = (await ApiAdapter.translateImage(cropBlob, true)).regions || [];
    } catch (err) {
      log('Ghep-bien: loi detect-only crop bien, bo qua.', err);
      return [];
    }
    if (!probeRegions.some((r) => r.y < ownStripH && r.y + r.h > ownStripH)) {
      log('Ghep-bien: detect-only khong thay vung vat-bien, bo qua (khong ton GPT).');
      return [];
    }

    let cropResult;
    try {
      cropResult = await ApiAdapter.translateImage(cropBlob);
    } catch (err) {
      log('Ghep-bien: loi dich anh crop bien, bo qua.', err);
      return [];
    }

    // Toa do tra ve la KHONG GIAN CUA ANH CROP NHO (0..ownStripH+stripH).
    // Diem 0 cua crop tuong ung y = naturalHeight - ownStripH trong anh
    // hien tai - cong offset nay la du, ap dung dung cho ca phan thuoc
    // "duoi anh hien tai" LAN phan thuoc "dau anh ke tiep" (ca 2 deu la
    // tiep noi truc tiep tu diem do trong khong gian anh hien tai).
    // CHI GIU vung VAT QUA ranh gioi (straddle): trong toa do crop, ranh gioi
    // giua [day anh hien tai] va [dau anh ke tiep] nam o y = ownStripH. Vung
    // NAM HAN 1 phia khong phai viec cua crop-bien:
    //  - Nam han TREN ranh gioi (r.y+r.h <= ownStripH): thuoc anh HIEN TAI,
    //    detect chinh cua no da bat du.
    //  - Nam han DUOI ranh gioi (r.y >= ownStripH): thuoc anh KE TIEP, detect
    //    chinh cua NO se bat DAY DU. Neu crop tra ve ban CUT o day (chi bat
    //    phan dau lot vao 500px), no se dang ky vao registry chong-trung ->
    //    CHAN anh ke tiep ve ban day du (bug thuc te: "I RECKON IT" cut, mat
    //    "COULD SWALLOW ALL YOUR LITTLE FRIENDS..."). Bo di.
    // Chi vung co noi dung o CA HAI phia (that su bi cat ngang giua 2 anh) moi
    // duoc crop-bien xu ly - dung muc dich ban dau cua no.
    const offsetY = img.naturalHeight - ownStripH;
    return (cropResult.regions || [])
      .filter((r) => r.y < ownStripH && r.y + r.h > ownStripH)
      .map((r) => ({ ...r, y: offsetY + r.y }));
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

  // Hop nhat vung tu detectBoundaryRegions() vao vung da detect chinh: dung
  // overlapRatio (containment) chu KHONG dung dedupeRegions/IoU thuong - anh
  // crop bien duoc detect o ty le KHAC voi anh/lat chinh, nen cung 1 noi dung
  // co the bi tach dong khac nhau giua 2 lan detect (vd 1 bong bong 3 dong o
  // lan chinh vs 3 vung 1-dong rieng le o lan crop) - IoU chuan se khong bat
  // duoc trung lap nay (xem ghi chu tren overlapRatio()).
  // Khi trung: GIU BAN DAY DU HON (dst dai hon), KHONG phai luon giu main.
  // Ly do (bug thuc te da do qua log): anh CHINH thuong cat chu o DAY anh ->
  // ban CUT ("OTHERWISE, THE LINE WILL"); crop bien bat duoc TRON cau vat qua
  // ranh gioi -> ban DU ("OTHERWISE, THE LINE WILL BE BROKEN..."). Neu luon
  // giu main thi ve ban cut, bo ban du -> mat chu. Nen giu ben nao co nhieu
  // chu dich hon.
  function mergeBoundaryRegions(base, boundary) {
    let result = [...base];
    for (const b of boundary) {
      const overlapping = result.filter((m) => overlapRatio(m, b) > 0.5);
      if (overlapping.length === 0) {
        result.push(b); // khong trung vung nao -> them noi dung moi
      } else if (overlapping.every((m) => (b.dst || '').length > (m.dst || '').length)) {
        // b day du hon MOI vung no trung -> bo cac vung do, thay bang b
        result = result.filter((m) => overlapRatio(m, b) <= 0.5);
        result.push(b);
      }
      // else: co 1 vung main day-du-hon-hoac-bang -> giu main, bo b
    }
    return result;
  }

  function isDuplicateOfRendered(img, region) {
    const candidate = toPageBBox(img, region);
    return renderedPageBBoxes.some((r) => overlapRatio(r, candidate) > 0.5);
  }

  // Chi giu mot cua so gan day. Registry nay chi phuc vu MOT viec: chan anh KE
  // TIEP ve lai noi dung ma anh LIEN TRUOC no da ve ho qua dai bien muon - tuc
  // no chi bao gio khop voi vai anh gan nhat. De no lon vo han tren chuong dai
  // vua ton bo nho vua lam isDuplicateOfRendered() (quet ca mang cho TUNG vung
  // cua TUNG anh) cham dan theo binh phuong do dai phien doc.
  // 200 la rat rong: moi anh chi gop vai vung dai-bien, tuc phu hon 50 anh gan nhat.
  const MAX_RENDERED_BBOXES = 200;

  function registerRenderedRegion(img, region) {
    renderedPageBBoxes.push(toPageBBox(img, region));
    if (renderedPageBBoxes.length > MAX_RENDERED_BBOXES) {
      renderedPageBBoxes.splice(0, renderedPageBBoxes.length - MAX_RENDERED_BBOXES);
    }
  }

  // ===== Job — tai + dich + ve overlay cho 1 anh (dung chung cho Queue) =====
  const state = { total: 0, done: 0, errors: 0 };
  // Luu loi chi tiet de nguoi dung bam nut xem lai (C4: "Loi - click xem"
  // - spec goc nghi cho 1 anh, o day gop thanh danh sach vi co nhieu anh).
  const errorLog = [];

  // ===== Tai truoc anh ke tiep (pipeline cua hang doi) =====
  // WeakMap: khong bao gio duyet, va khong duoc phep giu song mot <img> da roi
  // khoi DOM (dung loai ro ri vua sua o releaseImg).
  const _prefetchedBlobs = new WeakMap(); // img -> { src, promise }

  function startPrefetchBlob(img) {
    if (!img) return;
    const src = img.currentSrc || img.src || '';
    // blob:/data: doc thang pixel tu <img> dang hien thi, khong tai qua mang -
    // khong co gi de lam truoc.
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;
    const existing = _prefetchedBlobs.get(img);
    if (existing && existing.src === src) return; // dang tai roi

    const promise = (async () => {
      // Neu anh nay da co san ban dich thi duong dich se di fast path va khong
      // dung toi byte nao - tai ve la phi bang thong. Dung dung phep kiem tra
      // ma fast path dung.
      const targetLang = await getTargetLang();
      const engine = await getTranslatorEngine();
      const fully = await motIsUrlFullyCached(
        chrome.storage.local,
        src,
        (u) => Cache._urlKey(u),
        (h) => Cache._key(h, targetLang, engine)
      );
      if (fully) return null;
      return await downloadBlobFromUrl(src);
    })().catch((err) => {
      // Tai truoc that bai thi im lang: duong dich chinh se tu tai lai va bao
      // loi dung cach neu that su hong. Nuot o day de khong sinh unhandled
      // rejection cho mot viec chi mang tinh toi uu.
      log('Tai truoc anh ke tiep that bai, se tai lai luc dich:', err && err.message);
      return null;
    });

    _prefetchedBlobs.set(img, { src, promise });
  }

  // Lay blob da tai truoc, CHI khi no dung la cua src hien tai cua anh: reader
  // ao hoa co the da doi src cua chinh <img> nay trong luc cho, dung nham blob
  // cu la ve ban dich cua trang khac len trang nay.
  async function takePrefetchedBlob(img, src) {
    const entry = _prefetchedBlobs.get(img);
    if (!entry) return null;
    _prefetchedBlobs.delete(img);
    if (entry.src !== src) return null;
    return await entry.promise;
  }

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
        // Anh nay co the da duoc tai san trong luc backend dich anh truoc do
        // (xem startPrefetchBlob trong Queue._drain) - luc do buoc tai ~3s o
        // day bien mat hoan toan.
        const blob = (await takePrefetchedBlob(img, url)) || (await ApiAdapter.downloadImageBlob(img));
        const hash = await Cache.hashBlob(blob);
        result = await Cache.get(hash, targetLang, engine);
        if (result) {
          log('Cache HIT (hash):', hash, targetLang, engine, url);
        } else {
          log('Cache MISS, goi backend:', hash, targetLang, engine, url);
          if (img.naturalHeight > CFG.TILE_MAX_H) {
            result = await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight, img);
          } else {
            result = await ApiAdapter.translateImage(blob);
            const boundaryRegions = await detectBoundaryRegions(img, blob);
            result.regions = mergeBoundaryRegions(result.regions, boundaryRegions);
          }
          await Cache.set(hash, targetLang, engine, result);
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
        const _srcNonLatin = /[^\u0020-\u024F\s\d\p{P}]/u.test(_src);
        if (!_dst) {
          return false;
        }
        if (_dst.toLowerCase() === _src.toLowerCase() && _srcNonLatin) {
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
      // Nap thoai cua trang nay vao cua so cho trang sau. Dat SAU bo loc de
      // khong nap nham vung da bi loai, va chay ca khi trung cache - nho vay
      // trang da cache khong lam thung cua so.
      for (const r of result.regions) {
        motPushContext(dialogueWindow, r.src, r.dst);
      }
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
      // showErrorSummary() do het vao mot alert() - de danh sach lon vo han thi
      // vua ton bo nho, vua dung mot hop thoai khong the doc noi. state.errors
      // van dem du tong so that.
      if (errorLog.length > 50) errorLog.splice(0, errorLog.length - 50);
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
      // Sap xep lai theo vi tri Y tren trang - KHONG dua vao thu tu
      // IntersectionObserver bao ve trong entries[], da xac nhan thuc te
      // (test that tren webtoons.com) KHONG dam bao dung thu tu trang khi
      // nhieu anh cung luc lot vao PREFETCH_MARGIN (200% man hinh): anh
      // 0030 tung xu ly TRUOC anh 0029 dung phia truoc no. Xu ly sai thu tu
      // pha vo gia dinh cua dedup chong ve trung giua anh lien ke (xem
      // renderedPageBBoxes/isDuplicateOfRendered - dua vao gia dinh anh
      // truoc luon dang ky TRUOC anh sau xu ly) va dich khong theo thu tu doc.
      //
      // THU TU NAY LA DIEU KIEN DUNG DAN, KHONG PHAI SO THICH - dung doi sang
      // "uu tien anh gan khung nhin nhat" du nghe hop ly hon: dedup xuyen-anh
      // dua vao viec anh TRUOC luon dang ky vung da ve TRUOC anh sau (xem
      // registerRenderedRegion + ghi chu 2026-08-03 o translateAndRenderImage).
      // Xu ly khong theo thu tu trang lam vo dung gia dinh do va bong bong vat
      // bien bi ve hai lan - dung bug da mat hai vong go roi truc tiep tren
      // trinh duyet moi tim ra.
      //
      // Do san khoa sap xep MOT LAN moi anh thay vi doc trong ham so sanh:
      // sort() goi ham so sanh O(n log n) lan, moi lan 2 getBoundingClientRect,
      // tuc ~2100 lan cuong buc layout cho mot chuong 146 anh - trong khi chi
      // can dung 146. Thu tu ket qua khong doi mot ly nao.
      const keyed = this._pending.map((el) => ({
        el,
        top: el.getBoundingClientRect().top + window.scrollY,
      }));
      keyed.sort((a, b) => a.top - b.top);
      this._pending = keyed.map((k) => k.el);

      const img = this._pending.shift();
      if (!img) return;
      this._active++;
      // Bat dau TAI anh ke tiep ngay bay gio, de no chay song song voi luot
      // dich cua anh hien tai. Tai anh la I/O thuan, khong tranh chap GPU voi
      // backend, nen gan nhu giau duoc hoan toan trong thoi gian dich. Thu
      // thuat nay von da co trong prefetchHitomiGallery (co ghi kem so do:
      // ~10s/trang xuong ~7s/trang) nhung chua bao gio duoc ap vao chinh hang
      // doi nay - tuc moi site khong phai hitomi deu dang chay tuan tu cung.
      startPrefetchBlob(this._pending[0]);
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

  // Tra lai MOI thu gan voi 1 anh: layer, ResizeObserver rieng cua no, cho
  // trong imgLayers/_lastRect va cho trong hang doi. Tach rieng khoi
  // invalidateImg() vi co HAI ly do rat khac nhau can don:
  //  - anh doi src (invalidateImg): don xong roi DICH LAI noi dung moi;
  //  - anh bi xoa khoi DOM (releaseImg): don xong la het, khong dich lai gi.
  function releaseImg(img) {
    const layer = imgLayers.get(img);
    if (layer) {
      // disconnect() bat buoc: ResizeObserver dang quan sat <img> se giu song
      // ca <img> lan closure cua no (trong do co ca mang `regions` kem anh nen
      // base64) chung nao chua ngat.
      if (layer.__motRo) {
        layer.__motRo.disconnect();
        layer.__motRo = null;
      }
      _lastRect.delete(layer);
      layer.remove();
      imgLayers.delete(img);
    }
    // Go khoi hang doi truc tiep thay vi goi Queue.cancel(): cancel() ghi log
    // "cuon qua xa, chua kip dich" - dung nguyen nhan khac han, doc log se lac huong.
    const pendingIdx = Queue._pending.indexOf(img);
    if (pendingIdx !== -1) Queue._pending.splice(pendingIdx, 1);
    Queue._queued.delete(img);
    _prefetchedBlobs.delete(img); // bo blob da tai truoc cho anh khong con dung toi
    delete img.__motRenderedSrc;
  }

  // Reader AO HOA (virtual list, vd MangaPlaza) TAI DUNG cung <img> cho trang
  // khac (doi blob src). Khi src doi tren 1 anh DA render, layer cu la cua noi
  // dung CU -> vo hieu (xoa layer + bo danh dau) roi dich lai noi dung moi.
  function invalidateImg(img) {
    releaseImg(img);
    if (autoStarted) Queue.enqueue(img);
  }

  // Anh da bi XOA HAN khoi DOM (reader chuyen trang kieu xoa <img> cu di).
  // Truoc day khong ai xu ly truong hop nay: imgLayers la Map MANH nen <img>
  // da roi DOM, layer cua no va ResizeObserver cua no song vinh vien - do that
  // tren may nguoi dung la 263 .mot-layer / 2422 phan tu cho ve ven 13 <img>.
  //
  // Doi mot vong su kien roi moi kiem tra isConnected: nhieu reader DI CHUYEN
  // node bang cach xoa rồi chen lai ngay trong cung mot tac vu, neu don ngay
  // luc thay removedNodes thi se pha nham overlay cua mot anh van dang hien.
  function releaseIfDetached(img) {
    setTimeout(() => {
      if (!img.isConnected) {
        releaseImg(img);
        registeredImages.delete(img);
      }
    }, 0);
  }

  function registerImage(img) {
    if (registeredImages.has(img)) return;
    const tryRegister = () => {
      if (registeredImages.has(img)) return;
      if (!ImageFinder.isCandidate(img)) return;
      registeredImages.add(img);
      state.total++;
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
        // Anh roi khoi DOM -> tra lai layer + ResizeObserver cua no. Truoc day
        // chi theo doi addedNodes, nen reader nao XOA <img> (thay vi tai dung
        // no cho trang khac) deu lam ro ri vinh vien (xem releaseIfDetached).
        for (const node of m.removedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'IMG') releaseIfDetached(node);
          node.querySelectorAll?.('img').forEach(releaseIfDetached);
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

  // (downloadBlobFromUrl da chuyen len canh ApiAdapter - prefetch va duong dich
  // thuong gio dung CHUNG mot ham, khong con hai ban chep tay phai giu cho khop
  // hash nhau.)

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
    let done = 0;

    // Bo qua han viec tai neu URL da co san ban dich. Truoc day vong lap nay
    // chi GHI chi muc URL->hash (cuoi vong) ma khong bao gio DOC no, nen mo
    // lai mot gallery da dich xong 100% van tai lai TUNG anh mot - qua dung
    // duong 404->relay cham - chi de tinh lai cai hash da ghi san. Viec do
    // chay nen va tranh mang voi chinh trang nguoi dung dang xem, la mot
    // nguyen nhan cua trieu chung "lat nhanh thi overlay bi do".
    const CACHED = Symbol('cached');
    const blobIfNeeded = async (url) => {
      if (!url) return null;
      const fully = await motIsUrlFullyCached(
        chrome.storage.local,
        url,
        (u) => Cache._urlKey(u),
        (h) => Cache._key(h, targetLang, engine)
      );
      if (fully) return CACHED;
      return downloadBlobFromUrl(url).catch(() => null);
    };

    // Pipeline: tai truoc blob cua trang KE TIEP trong luc backend dich trang
    // hien tai. Backend (~7s) >> tai anh (~3s) nen viec tai bi GIAU HOAN TOAN
    // trong luc dich -> throughput prefetch ~7s/trang thay vi ~10s (tai la
    // I/O, khong tranh GPU voi dich). Xem investigation 2026-08-08.
    let nextBlobP = blobIfNeeded(urls[0]);
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
      nextBlobP = i + 1 < urls.length ? blobIfNeeded(urls[i + 1]) : Promise.resolve(null);
      if (blob === CACHED) {
        done++;
        updatePrefetchToast(done, urls.length);
        continue;
      }
      try {
        if (blob) {
          const hash = await Cache.hashBlob(blob);
          let cached = await Cache.get(hash, targetLang, engine);
          if (!cached) {
            // NHUONG LAN NUA, ngay truoc khi gui lenh dich di. Vong `while` o
            // dau vong lap chi chan luc BAT DAU; tu do toi day da co viec tai
            // anh (~3s) xen vao, thua du de nguoi doc lat sang trang khac. Mot
            // khi translateImage() da bay thi KHONG gi dung duoc no, ma backend
            // chi co 1 executor -> trang dang xem phai xep hang sau tron mot
            // luot dich prefetch (~7-16s). Do chinh la trieu chung "lat nhanh
            // thi overlay do mot luc moi hien".
            while (Queue._active > 0 || Queue._pending.length > 0) {
              await new Promise((r) => setTimeout(r, 300));
            }
            // Trong luc cho o tren, chinh trang dang xem co the da dich xong
            // dung anh nay va ghi vao cache - tra lai de khoi ton mot luot
            // backend trung lap (~7-16s).
            cached = await Cache.get(hash, targetLang, engine);
          }
          if (!cached) {
            const result = await ApiAdapter.translateImage(blob);
            await Cache.set(hash, targetLang, engine, result);
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
    // state.errors la tong SO THAT; errorLog chi giu 50 loi gan nhat (xem cho
    // push). Dung state.errors de con so bao ra khong bi cat cut theo.
    const omitted = state.errors - errorLog.length;
    const note = omitted > 0 ? `\n\n(chỉ hiện ${errorLog.length} lỗi gần nhất, ${omitted} lỗi cũ hơn đã lược)` : '';
    alert(
      `Dịch xong nhưng có ${state.errors} ảnh lỗi:\n\n${lines.join('\n')}${note}`
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
    // Khong await: migration chi anh huong toc do, khong duoc chan viec dich.
    motMigrateUrlHashKeys(chrome.storage.local, URLHASH_PREFIX, URLHASH_MIGRATED_FLAG, log).catch((e) =>
      log('Bo qua migration chi muc URL:', e)
    );
    log('San sang. Bam icon extension hoac Alt+D de dich, Alt+T de bat/tat overlay.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
