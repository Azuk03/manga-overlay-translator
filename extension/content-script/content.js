(function () {
  'use strict';

  const CFG = {
    // Endpoint dung /translate/json/stream, KHONG PHAI /translate/json
    // (endpoint khong-stream bi crash 500 - xem README.md muc "Bug da tim ra + va").
    API: 'http://127.0.0.1:5003/translate/json/stream',
    TARGET_LANG: 'VIN',
    TRANSLATOR: 'chatgpt', // da xac nhan hoat dong o Giai doan B
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
    if (CFG.DEBUG) console.log('[MOT]', ...args);
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
    _key(hash) {
      return `mot_cache_v${CFG.CACHE_VERSION}_${hash}`;
    },
    async get(hash) {
      const key = this._key(hash);
      const result = await chrome.storage.local.get(key);
      return result[key] ? JSON.parse(result[key]) : null;
    },
    async set(hash, value) {
      const key = this._key(hash);
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
      const rawBlob = new Blob([res.arrayBuffer], { type: res.contentType });
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
      const body = JSON.stringify({
        image: dataUrl,
        config: {
          translator: {
            translator: CFG.TRANSLATOR,
            target_lang: CFG.TARGET_LANG,
            gpt_config: CFG.GPT_CONFIG_PATH,
          },
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

    async translateImageTiled(blob, naturalW, naturalH) {
      const tiles = await sliceImageIntoTiles(blob, naturalW, naturalH);
      log(
        'Webtoon dai (' + naturalH + 'px > TILE_MAX_H ' + CFG.TILE_MAX_H + 'px) - cat thanh',
        tiles.length,
        'lat, chong lan',
        CFG.TILE_OVERLAP,
        'px.'
      );
      const allRegions = [];
      for (const tile of tiles) {
        const result = await this.translateImage(tile.blob);
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

  console.log('[MOT] ApiAdapter + tile helpers da nap xong (Task 7).');
})();
