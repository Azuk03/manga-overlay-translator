// ==UserScript==
// @name         Manga Overlay Translator (local)
// @namespace    local
// @version      0.40
// @match        *://*/*
// @match        http://localhost/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/manga-overlay-translator.user.js
// @downloadURL  https://raw.githubusercontent.com/Azuk03/manga-overlay-translator/main/manga-overlay-translator.user.js
// ==/UserScript==

// C1 (dich 1 anh, log JSON) + C2 (ve chu de len anh bang CSS) + C3 (auto +
// cuon) + C4 (kich hoat qua menu Tampermonkey/hotkey, click xem chu goc,
// bao loi than thien) da xong. Con lai: Phan 6 (tieu chi nghiem thu) +
// webtoon tiling (spec 5.7, chua lam).
// Xem README.md o thu muc backend de biet schema/bug da va.
//
// v0.7: bat INPAINTER THAT (xoa chu goc bang AI thay vi ve khoi mau che) +
// gpt_config tuy chinh (La-tinh hoa ten rieng/thuat ngu trong ngoac kep).
// Xem README.md muc "Inpaint that" de biet ly do + cach test.
// v0.9: da revert tinh nang danh so thu tu doc (theo yeu cau) - regions
// hien dung dung thu tu backend tra ve, khong sap xep lai.
// v0.13 (C3): tu dong phat hien anh (MutationObserver, bat lazy-load) +
// Queue (CONCURRENCY tu CFG) + prefetch khi cuon (IntersectionObserver,
// rootMargin PREFETCH_MARGIN).
// v0.15-v0.21 (da bo o v0.22): thu nhieu cach de nut noi trong trang luon
// bam duoc du site co quang cao - z-index toi da, Popover API/top layer,
// dinh ky gianh lai vi tri, chan click o capture phase dang ky som nhat co
// the (@run-at document-start)... Xac nhan thuc te (DevTools) la nut da
// vao dung top layer, nhung mot so site van co cach khac de can thiep -
// ket luan: KHONG CO CACH NAO trong DOM cua trang dam bao 100%, vi trang
// co toan quyen voi DOM/JS cua no.
// v0.22: BO HAN nut noi. Kich hoat dich qua GM_registerMenuCommand (menu
// Tampermonkey, ngoai DOM trang - trang KHONG THE cham toi) + hotkey
// Alt+D. Day la co che DUY NHAT dam bao 100% khong bi trang can thiep.
// v0.23 (5.7): Webtoon dai - anh cao hon TILE_MAX_H (4000px) duoc
// sliceImageIntoTiles() cat thanh nhieu lat chong lan TILE_OVERLAP (200px)
// bang canvas (tu Blob, khong tainted), gui rieng tung lat qua
// ApiAdapter.translateImageTiled(), cong offset y roi dedupeRegions()
// (IoU > 0.5, giu bbox lon hon) de loai bong thoai bi dich 2 lan o duong cat.
// v0.24: (KHONG DU, xem v0.25) thu doi fetch() sang unsafeWindow.fetch()
// cho anh <img src="blob:..."> (vd mangaz.com) - van loi ERR_FILE_NOT_FOUND.
// v0.25: nguyen nhan thuc su la blob: URL bi CHINH TRANG THU HOI
// (URL.revokeObjectURL()) ngay sau khi giai ma xong anh (chong scrape) -
// khong lien quan sandbox/"the gioi" JS, fetch lai kieu gi cung fail vi du
// lieu khong con ton tai. Doi sang imageElementToBlob(): doc pixel TRUC
// TIEP tu <img> da hien thi bang canvas, khong fetch lai qua mang nua.
// v0.26: fix loi overlay hien thi vo cung sai (chu chong chat, ti hin,
// mau loan xa) - CSS cua GM_addStyle() KHONG duoc ap dung vi script van
// chay @run-at document-start (con sot lai tu vu chong click-hijack cho
// nut noi, DA BO o v0.22), goi GM_addStyle() truoc ca khi <head> ton tai.
// Doi lai document-idle - khong con nut noi trong trang nen khong can
// chay som nua, GM_registerMenuCommand khong phu thuoc thoi diem trang.
// v0.27: fix loi "Uncaught (in promise) undefined" tu chinh vien JS cua
// site (vd mangaz.com, dung React/Webpack) - boc <img> vao <span
// class="mot-wrap"> (cach cu) doi cay DOM cua trang, kich hoat nham
// resize/mutation listener NOI BO cua viewer do, lam VO chinh animation
// chuyen trang cua site (khong phai loi tu code cua toi, nhung do toi gay
// ra). BO HAN cach boc <span> - gio gan .mot-layer THANG vao <body>, tu
// tinh vi tri bang getBoundingClientRect() (positionLayer()), KHONG dung
// gi den DOM cua <img> goc nua. Dung Map imgLayers (thay vi tim qua
// .closest('.mot-wrap')) de biet anh nao da co overlay.
// v0.28: BACKEND (khong phai userscript) - patches/gpt_config-vi.yaml
// (chat_system_template tuy chinh) thay the hoan toan prompt mac dinh cua
// manga_translator, vo tinh bo mat dong bat buoc "giu nguyen marker
// <|N|>" ma parser CommonGPTTranslator._parse_response() can de tach dung
// tung dong dich (xem common_gpt.py/config_gpt.py trong container) - GPT
// tra loi tu nhien khong co marker -> "Found indices count (0) does not
// match expected count (N)" -> dich that bai/bi loc rong. Da them lai chi
// dan + vi du <|N|> vao prompt tuy chinh. CAN REBUILD IMAGE (docker build)
// + restart container de ap dung. Bump CACHE_VERSION vi ket qua dich cu
// (rong/sai) da bi cache lai.
// v0.29: AI inpaint (lama_mpe) xoa chu rat tot tren bong thoai trang
// phang nhung de lai vet mo/nhoe ro ret tren nen nhieu mau/chi tiet (toc,
// gradient, net ve day) - gioi han cua model, khong sua duoc bang code.
// Them computeRegionComplexity(): do do lech chuan do sang trong bbox ANH
// GOC (createImageBitmap cat truc tiep, khong dung canvas full-trang -
// an toan voi webtoon dai) de doan vung "busy"; vung do BO HAN lop nen
// inpaint, chi con chu vien trang de tren anh goc (khong nhoe, du chu goc
// co the con lo mo phia sau). Cung bo BG_PAD (tung noi rong 8% + keo gian
// anh inpaint, gay "mieng va" lech mau ro tren nen mau) - nen gio khit
// dung bbox backend tra ve.
// v0.30: vung "busy" (khong con nen inpaint tu v0.29) gio co them nen
// trang mo (rgba trang 85%) + border-radius + box-shadow (class .mot-busy)
// de chu dich noi bat ro rang hon tren tranh nhieu mau/chi tiet, khong
// chi dua vao vien trang cua .mot-text. Vung co nen inpaint sach (khong
// busy) giu nguyen trong suot nhu cu - them nen o day se thua/de len chinh
// nen inpaint.
// v0.31: FIX BUG THAT o computeRegionComplexity() (v0.29) - do that qua
// test end-to-end voi backend that: ham do do lech chuan tren ANH GOC
// (truoc inpaint), nhung bbox GOC luon CHUA CHINH CHU CAN DICH (ly do no
// duoc detect) - chu den/trang tuong phan cao day std len ~85-118 (do thuc
// te tren 65 vung chu that), vuot xa BUSY_STD_THRESHOLD=25 -> HAU NHU MOI
// VUNG (12/12 trong test that) bi gan nham busy=true, bo qua het lop nen
// inpaint (du inpaint that ra rat sach - std hau-inpaint do thuc te cung
// tren cac vung do chi 0.4-2.8). Sua: do do lech chuan tren r.background
// (anh DA INPAINT, backend tra san, khit bbox) thay vi crop lai anh goc -
// khong con can Blob/naturalW/naturalH/createImageBitmap nua, ham gon hon
// VA do dung thu can do ("nen sau inpaint co sach khong"). Khong can bump
// CACHE_VERSION (busy khong nam trong du lieu cache, tinh lai moi lan
// render). Nguong BUSY_STD_THRESHOLD=25 giu nguyen (van dung tot cho tin
// hieu moi - vung sach do duoc 0.4-2.8, con xa nguong) nhung CHUA co vi du
// that cua vung "inpaint hong/con nhoe" de kiem chung chieu con lai cua
// nguong - can chinh lai neu gap truong hop do trong thuc te.
// v0.32: FIX BUG THAT (test that tren hitomi.la) - anh .avif tai tu CDN
// site that (vd a2.gold-usergeneratedcontent.net) luon loi HTTP 422 khi
// dich, gop vao tom tat loi cuoi trang. Dieu tra bang cach gui THANG file
// .avif that do cho backend qua curl: tra ve {"detail":"cannot identify
// image file <_io.BytesIO ...>"} - loi kinh dien cua Pillow (Python) khi
// KHONG co plugin doc dinh dang do (AVIF khong duoc Pillow ho tro san,
// can pillow-avif-plugin/libavif). Khong lien quan userscript, Coc Coc,
// hay cache - BAT KY anh .avif nao gui len se loi y het, luon luon.
// Sua (o phia userscript, khong dung Docker): them reencodeToPng() -
// downloadImageBlob() gio LUON ve lai blob tai duoc qua canvas
// (createImageBitmap -> canvas.toBlob('image/png')) truoc khi tra ve,
// dua vao viec trinh duyet (Chromium) giai ma duoc AVIF/WebP/hau het
// dinh dang hien dai de HIEN THI - re-encode lai thanh PNG (Pillow doc
// duoc chac chan) truoc khi gui backend. Bao ve cho MOI dinh dang la
// Pillow co the khong doc duoc, khong rieng AVIF. (Nhanh blob:/data: URL
// qua imageElementToBlob() da xuat PNG san tu C2, khong bi anh huong.
// Nhanh webtoon tiling cung da vo tinh mien nhiem vi sliceImageIntoTiles()
// luon ve lai qua canvas moi lat - chi nhanh anh thuong, khong tiling, la
// dinh bug nay.)
// v0.33: FIX BUG THAT (test that tren Coc Coc that, ngay sau khi len
// v0.32) - reencodeToPng() (v0.32) dung createImageBitmap(blob) de giai
// ma anh tai ve, nhung Coc Coc that bao "InvalidStateError: The source
// image could not be decoded." Dieu tra: test CUNG 1 file AVIF that (tai
// qua network that, Content-Type/blob.type dung "image/avif") tren
// Chromium khac - createImageBitmap() OK, <img> cung OK. Ket luan: day la
// khac biet codec AVIF GIUA 2 API giai ma cua rieng ban Chromium trong Coc
// Coc (createImageBitmap() thieu codec AVIF nhung <img> thi co) - tung la
// loi da biet o 1 so ban Chromium doi/fork. Sua: doi reencodeToPng() sang
// dung LAI <img> + canvas (giong het imageElementToBlob() da on dinh tu
// C2) thay vi createImageBitmap() - dang tin cay hon qua nhieu trinh
// duyet/dinh dang. Khong anh huong sliceImageIntoTiles() (van dung
// createImageBitmap rieng, nhung gio LUON nhan blob DA la PNG tu
// downloadImageBlob() - PNG thi createImageBitmap doc duoc moi noi,
// khong dinh gioi han codec nhu AVIF).
// v0.34: DANG DIEU TRA - v0.33 (<img>+canvas) VAN loi giai ma tren Coc Coc
// that ("Error: Khong giai ma duoc anh tai ve") giong het v0.32
// (createImageBitmap()), du 2 API giai ma khac hoan toan nhau - da loai
// tru CSP chan blob: URL (khong thay canh bao CSP nao trong console that).
// Ca 2 API cung that bai tren CUNG 1 file goi y van de co the KHONG PHAI o
// viec chon API giai ma, ma o chinh Blob GM_xmlhttpRequest tai ve (hong/
// thieu du lieu do quirk rieng cua Coc Coc, hoac gioi han kich thuoc/tai
// nguyen giai ma script-context cua Coc Coc thap hon nhieu so voi decode
// pipeline hien thi <img> binh thuong cua chinh trang). Them log CHAN DOAN
// tam thoi (size/type cua blob tai ve) o downloadImageBlob() de xac dinh
// dung nguyen nhan o lan test tiep theo, truoc khi thu sua tiep lan 3 mot
// cach mu quang. Neu xac nhan Blob binh thuong (dung size/type that) ma
// van khong giai ma duoc qua BAT KY API script nao, huong sua thuc te nhat
// se la quay lai phia BACKEND (cai them pillow-avif-plugin vao Dockerfile,
// da tu choi luc dau vi nghi sua o userscript don gian hon - hoa ra khong
// don gian nhu tuong, vi Coc Coc co gioi han rieng ca 2 huong).
// v0.35: FIX BUG THAT (goc re that su cua ca chuoi loi 422/InvalidState/
// "khong giai ma duoc" tu v0.32-v0.34) - log CHAN DOAN v0.34 lo ra: blob
// GM_xmlhttpRequest tai ve tren Coc Coc that chi 555 byte, type
// "text/html" (KHONG PHAI anh AVIF that ~509KB). Xac nhan qua curl: CDN
// anh cua hitomi.la (a2.gold-usergeneratedcontent.net) chan hotlink khi
// request KHONG co header Referer hop le -> tra ve trang loi nho thay vi
// anh that; CO Referer dung trang -> HTTP 200, du 508964 byte AVIF that.
// Sua: GM_xmlhttpRequest (khac fetch/XHR thuong bi trinh duyet cam dat
// header Referer - "forbidden header") duoc phep tu dat Referer (1 trong
// nhung dac quyen cua no, xem 2.2/2.3) - them headers: {Referer:
// location.href} vao request tai anh, gui dung Referer nhu chinh <img
// src> that cua trang se gui. Day moi la nguyen nhan GOC - viec doi API
// giai ma o v0.32 (createImageBitmap) va v0.33 (<img>) khong sai (van giu
// lai, van co ich cho cac dinh dang Pillow khong doc duoc that su) nhung
// khong dung goc, vi du lieu vao tu dau da la HTML loi, khong phai anh.
// Them kiem tra som: neu blob tra ve khong phai Content-Type "image/*",
// bao loi ro rang ngay (kem Content-Type + kich thuoc) thay vi de loi
// giai ma chung chung kho doan - bai hoc rut ra tu chinh vu debug nay.
// v0.36: FIX BUG THAT (test that tren hitomi.la, sau khi dich thanh cong
// nho v0.35) - site dang "reader" (Prev/Next/Page N) giu <img> cua NHIEU
// trang trong DOM cung luc, chi AN (display:none/kich thuoc 0) cac trang
// khong phai trang dang xem thay vi xoa khoi DOM. Khi 1 <img> nhu vay bi
// dich xong roi moi bi an, positionLayer() chay lai (window resize, hoac
// ResizeObserver rieng cua <img> do khi no tu co ve 0x0) tinh ra rect =
// {0,0,0,0} -> layer dat dung vao goc (0,0) trang - nhieu trang cu don
// lai CHONG LEN NHAU dung 1 diem, hien ra nhu chu dich "nhay" don vao goc
// trai man hinh (loi thuc te da gap, xem anh chup nguoi dung gui). Sua:
// rect suy bien (w=0 hoac h=0) -> day layer ra HAN NGOAI man hinh
// (left/top: -99999px) thay vi de no roi ve (0,0). KHONG dung
// layer.style.display o day (thuoc tinh nay da danh rieng cho Alt+T
// bat/tat so sanh goc/dich - doi o day se ghi de nham trang thai nguoi
// dung da chon).
// v0.37: FIX HIEU NANG THAT (nguoi dung bao UI hien chu dich cham vai
// giay SAU KHI backend/console da log "finished") - computeRegionComplexity()
// (v0.31) chay TUAN TU tung vung 1 (for...of + await), dung CHUNG 1
// canvas. Voi trang ~20-25 vung chu (dung so lieu that da do), tong thoi
// gian giai ma <img> TUAN TU cong don de dang len toi vai giay - dung
// nguyen nhan. Sua: moi vung tu tao canvas RIENG (re, GC ngay) de chay
// THAT SU song song qua Promise.all() - truoc day khong the doi truc
// tiep sang Promise.all vi dung chung canvas se lem du lieu pixel giua
// cac vung ve dong thoi. Them log do thoi gian TAM THOI de xac nhan cai
// thien that - xoa sau khi xac nhan xong.
// v0.38: DANG DIEU TRA hieu nang - test that xac nhan computeRegionComplexity
// (v0.37) chi con 34ms/14 vung, KHONG con la diem nghen, nhung nguoi dung
// van bao UI hien chu cham vai giay sau khi console da log "finished".
// Doi log do thoi gian tu 1 dong (chi computeRegionComplexity) thanh do
// TUNG BUOC trong translateAndRenderImage: tai anh goc (downloadImageBlob,
// bao gom ca reencodeToPng), hash anh, GOI BACKEND (bao gom nhan het
// response qua mang - vi "finished" chi la 1 frame TIEN DO nam GIUA
// response stream, KHONG PHAI frame cuoi cung - frame ket qua that
// (status=0, chua toan bo JSON + base64 background cua moi vung) den
// SAU frame "finished", nen co the day moi la nguon do tre that: cong
// them thoi gian truyen + JSON.parse() payload lon), Cache.set()
// (GM_setValue - da thay IPC cua Coc Coc cham hon Chromium thuong o vu
// chrome.userScripts truoc day, co the anh huong ca o day), va render
// DOM. Se xac dinh dung diem nghen o lan test tiep theo dua vao dong log
// timing moi - xoa toan bo khoi log nay sau khi xac nhan xong.
// v0.39: KET QUA dieu tra hieu nang (v0.37-v0.38) - test that + doi chieu
// LOG DOCKER THAT: 1 anh rieng le, khong co gi khac chay cung, mat ~7.6s
// THAT o backend (detect ~0.5s, OCR ~1.5s, GPT dich ~2.3-3.6s - GPT THAT
// SU NHANH dung nhu nguoi dung quan sat, mask+inpaint ~0.8s, ma hoa
// response+truyen mang ~0.5s). Con "18 giay" do duoc truoc do la do
// TRANH CHAP HANG DOI (CONCURRENCY:1 - backend CHI xu ly 1 anh/luc) khi
// nhieu request chay chong len nhau (luc do co nhieu script test cua toi
// chay song song). Khong the rut ngan them thoi gian AI THAT bang code
// userscript - detect/OCR/inpaint la GPU inference dia phuong, GPT la
// goi API ngoai, ca 2 deu ngoai tam voi cua trinh duyet. Diem CO THE cai
// thien that: TRANH hang doi khong can thiet - neu PREFETCH_MARGIN kich
// hoat dich SOM (trong luc nguoi doc con dang xem trang truoc), thoi gian
// AI 7-8s do se troi qua AN, nguoi doc cuon toi thay ket qua co san ngay;
// nguoc lai neu nhieu anh bi kich hoat dich CUNG LUC (cuon nhanh qua
// nhieu trang), anh sau phai xep hang that su sau anh truoc. Them 2 log
// CHAN DOAN de nguoi dung tu kiem tra TRONG CHINH Coc Coc that (khong can
// qua toi doc log Docker moi lan): (1) Queue._drain() log thoi gian CHO
// HANG DOI truoc khi bat dau xu ly + so anh khac con xep hang - neu cao,
// nghia la dang bi dich nhieu anh dong thoi that su gay xep hang; (2)
// onprogress() trong translateImage() log thoi diem byte dau tien ve
// (an toan, chi doc SO byte qua event.loaded, KHONG doc/giai ma noi dung -
// giao thuc nhi phan co header la so nguyen tho, doc dan qua
// responseType:'text' se co rui ro hong du lieu neu chunk cat giua byte
// nhi phan, nen KHONG lam) - phan biet "dang cho backend xu ly" (chua co
// byte) voi "backend xong, dang truyen response lon ve" (da co byte).

// v0.40: them @updateURL/@downloadURL de Tampermonkey tu bao ban cap nhat moi.
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
    DEBUG: true,
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
  const Cache = {
    async hashBlob(blob) {
      const buf = await blob.arrayBuffer();
      if (crypto?.subtle) {
        const h = await crypto.subtle.digest('SHA-256', buf);
        return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
      // Fallback cho trang HTTP (crypto.subtle chi co trong secure context).
      const u8 = new Uint8Array(buf);
      let h = 0x811c9dc5;
      for (let i = 0; i < u8.length; i++) {
        h ^= u8[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return 'fnv' + h.toString(16) + '_' + u8.length;
    },
    // key duoc ghep them CACHE_VERSION (xem CFG) - moi lan doi config quan
    // trong (INPAINTER, GPT_CONFIG_PATH, TARGET_LANG...) chi can tang so nay,
    // cache cu tu dong bi bo qua, khong can nguoi dung tu xoa Storage tay.
    _key(hash) {
      return `mot_cache_v${CFG.CACHE_VERSION}_${hash}`;
    },
    get(hash) {
      const raw = GM_getValue(this._key(hash), null);
      return raw ? JSON.parse(raw) : null;
    },
    set(hash, value) {
      GM_setValue(this._key(hash), JSON.stringify(value));
    },
  };

  // v0.31: DA SUA BUG - ban dau do do lech chuan tren ANH GOC (truoc
  // inpaint), nhung bbox GOC luon chua chinh chu can dich (do la ly do no
  // duoc detect!) - chu den/trang tuong phan cao tu no da day std len
  // ~85-118 (do thuc te qua test end-to-end that: 65/65 vung chu that deu
  // vuot xa nguong 25), khien HAU NHU MOI VUNG bi gan nham busy=true, bo
  // qua lop nen inpaint (du inpaint that ra rat sach - cung do thuc te tren
  // chinh cac vung do: std hau-inpaint chi 0.4-2.8). Sua: do do lech chuan
  // tren ANH DA INPAINT (r.background, backend da tra san, dung khit bbox,
  // KHONG can Blob/naturalW/naturalH/createImageBitmap crop nua) - do dung
  // cai code thuc su muon biet ("nen sau inpaint co sach khong"), khong bi
  // nhieu boi chinh chu nguon.
  // v0.37: FIX HIEU NANG THAT (nguoi dung bao UI hien chu dich cham vai
  // giay SAU KHI backend/console da log "finished") - ham nay TRUOC ĐAY
  // chay TUAN TU tung vung 1 (for...of + await), dung CHUNG 1 canvas cho
  // moi vung. Voi trang co ~20-25 vung chu (dung so lieu that da do o cac
  // lan test truoc) va moi vung can 1 vong doi <img> giai ma (thuong vai
  // chuc ms), tong thoi gian TUAN TU cong don de dang len toi vai giay -
  // dung nguyen nhan nguoi dung bao. Dung chung 1 canvas la ly do KHONG
  // the chi doi for...of thanh Promise.all() truc tiep truoc day (nhieu
  // vung ve chong len cung 1 canvas cung luc se lem/sai du lieu pixel cho
  // nhau). Sua: moi vung tu tao canvas RIENG (canvas nho, chi phi tao rat
  // re, don GC ngay sau khi ham tra ve) - cho phep chay THAT SU song song
  // qua Promise.all(), trinh duyet giai ma nhieu <img> cung luc thay vi
  // doi tung cai mot.
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

  // ===== ApiAdapter — NOI DUY NHAT BIET SCHEMA BACKEND =====
  const ApiAdapter = {
    async downloadImageBlob(img) {
      const src = img.currentSrc || img.src;
      if (src.startsWith('blob:') || src.startsWith('data:')) {
        // blob: URL co the DA BI CHINH TRANG THU HOI (URL.revokeObjectURL())
        // ngay sau khi trinh duyet giai ma xong anh de hien thi - ky thuat
        // chong scrape kha pho bien o site truyen chinh thong (vd mangaz.com).
        // Luc do fetch lai URL do (du dung unsafeWindow.fetch dung "the
        // gioi" JS that) van that bai net::ERR_FILE_NOT_FOUND vi du lieu
        // khong con ton tai trong blob store nua - KHONG PHAI van de sandbox.
        // Giai phap dang tin cay: doc THANG pixel tu chinh <img> DA HIEN
        // THI (trinh duyet da giai ma san trong bo nho, khong can tai lai
        // qua mang). blob:/data: URL duoc coi la CUNG-GOC (same-origin)
        // voi trang da tao ra no (khac han anh cross-origin that chua co
        // CORS header), nen drawImage() TU <img> NAY khong lam canvas bi
        // tainted (xem docs.md muc "tainted canvas"). imageElementToBlob()
        // da xuat PNG san (canvas.toBlob(..., 'image/png')) nen khong can
        // reencodeToPng() them o day.
        return await imageElementToBlob(img);
      }
      const rawBlob = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: src,
          responseType: 'blob',
          timeout: CFG.TIMEOUT_MS,
          // v0.35: FIX BUG THAT TIM RA NHO LOG CHAN DOAN v0.34 - blob tai
          // ve tren Coc Coc that chi 555 byte, type "text/html" (KHONG
          // PHAI anh that ~509KB/"image/avif") - CDN (vd
          // a2.gold-usergeneratedcontent.net cua hitomi.la) chan hotlink
          // khi request KHONG co header Referer hop le, tra ve 1 trang loi
          // nho thay vi anh that. Da xac nhan qua curl: cung URL do, KHONG
          // Referer -> 404 trang loi; CO Referer dung trang -> HTTP 200,
          // du 508964 byte anh AVIF that. GM_xmlhttpRequest (khac fetch/XHR
          // thuong) duoc phep tu dat header Referer (mot trong nhung dac
          // quyen cua no, xem 2.2/2.3) - truyen Referer = URL trang hien
          // tai, giong het request that <img src> cua chinh trang se gui.
          // Day moi la nguyen nhan GOC cua ca chuoi loi 422/InvalidState/
          // "khong giai ma duoc" o v0.32-v0.34 - viec doi API giai ma
          // (createImageBitmap <-> <img>) o 2 ban truoc khong sai nhung
          // khong chua dung goc, vi du lieu vao da la HTML thay vi anh
          // ngay tu buoc tai ve.
          headers: { Referer: location.href },
          onload: (res) => resolve(res.response),
          onerror: () => reject(new Error('Khong tai duoc anh goc: ' + src)),
          ontimeout: () => reject(new Error('Timeout khi tai anh goc')),
        });
      });
      // v0.35: kiem tra som - neu CDN van chan (site khac, Referer khac
      // yeu cau...), blob tra ve se KHONG phai dinh dang anh (thuong la
      // text/html cua trang loi) - bao loi ro rang thay vi de
      // reencodeToPng() bao "khong giai ma duoc" chung chung, kho doan
      // nguyen nhan (dung dung bai hoc tu vu debug v0.32-v0.34 o tren).
      if (rawBlob.type && !rawBlob.type.startsWith('image/')) {
        throw new Error(
          `CDN tra ve khong phai anh (Content-Type: ${rawBlob.type}, ${rawBlob.size} byte) - co the site chan hotlink/anh da bi xoa: ${src}`
        );
      }
      // v0.32: xem ghi chu reencodeToPng() o tren - dinh dang tai ve co the
      // la thu Pillow khong doc duoc (vd AVIF).
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

      // v0.39: log CHAN DOAN tam thoi. onprogress chi doc SO BYTE da nhan
      // (event.loaded/total - AN TOAN, KHONG doc/giai ma noi dung tung
      // phan), KHONG the dung de hien ten tung buoc (detection/ocr/dich...)
      // real-time - giao thuc nhi phan co phan header la so nguyen tho
      // (status byte + do dai 4 byte), ep qua responseType:'text' de doc
      // dan se co rui ro UTF-8 giai ma sai/hong du lieu neu 1 chunk cat
      // giua byte nhi phan do. Chi dung de phan biet "dang cho backend xu
      // ly xong" (chua co byte nao) voi "backend xong roi, dang truyen ve"
      // (da co byte, payload lon vi background base64 cua nhieu vung).
      const tReqStart = performance.now();
      let firstByteAt = null;
      const arrayBuffer = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST',
          url: CFG.API,
          data: body,
          headers: { 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: CFG.TIMEOUT_MS,
          onprogress: (ev) => {
            if (firstByteAt === null && ev.loaded > 0) {
              firstByteAt = performance.now();
              log(`DEBUG byte dau tien ve sau ${(firstByteAt - tReqStart).toFixed(0)}ms (backend da xu ly xong toi day, dang truyen response)`);
            }
          },
          onload: (res) => {
            if (res.status >= 400) {
              reject(new Error('HTTP ' + res.status));
            } else {
              const tDone = performance.now();
              log(
                `DEBUG nhan xong response sau ${(tDone - tReqStart).toFixed(0)}ms tong` +
                  (firstByteAt !== null ? ` (truyen du lieu: ${(tDone - firstByteAt).toFixed(0)}ms)` : ' (khong bat duoc onprogress)')
              );
              resolve(res.response);
            }
          },
          onerror: () => reject(new Error('Backend chua bat? Kiem tra docker ps')),
          ontimeout: () => reject(new Error('Backend qua cham, thu lai')),
        });
      });

      return this.normalizeResponse(arrayBuffer);
    },

    // Backend /translate/json/stream tra ve BINARY STREAM, KHONG PHAI JSON thuan.
    // Frame: [1 byte status][4 byte length big-endian][N byte payload]
    // status: 0 = ket qua cuoi (payload = JSON UTF-8) | 2 = loi (payload = text loi)
    //         1/3/4 = tien do (bo qua). Dung khi gap status 0 hoac 2.
    // Chi tiet + ly do dung endpoint nay xem README.md backend.
    normalizeResponse(arrayBuffer) {
      const view = new DataView(arrayBuffer);
      let offset = 0;
      let finalPayload = null;
      let errorPayload = null;

      while (offset < arrayBuffer.byteLength) {
        const status = view.getUint8(offset);
        const length = view.getUint32(offset + 1, false);
        const payloadStart = offset + 5;
        const payload = arrayBuffer.slice(payloadStart, payloadStart + length);

        if (status === 0) {
          finalPayload = payload;
          break;
        }
        if (status === 2) {
          errorPayload = payload;
          break;
        }
        if (CFG.DEBUG) {
          log('tien do:', status, new TextDecoder().decode(payload));
        }
        offset = payloadStart + length;
      }

      if (errorPayload) {
        throw new Error('Backend tra loi: ' + new TextDecoder('utf-8').decode(errorPayload));
      }
      if (!finalPayload) {
        throw new Error('Stream ket thuc som, khong co ket qua cuoi');
      }

      const json = JSON.parse(new TextDecoder('utf-8').decode(finalPayload));

      // minX/minY/maxX/maxY la px TUYET DOI theo anh goc (da xac nhan o Giai doan B).
      // text.src/text.dst la ten field SAU KHI VA bug backend (xem README.md).
      // background = anh DA INPAINT (xoa chu that) dung khit bbox goc, base64 PNG.
      const regions = json.translations.map((t) => ({
        x: t.minX,
        y: t.minY,
        w: t.maxX - t.minX,
        h: t.maxY - t.minY,
        src: t.text.src || '',
        dst: t.text.dst || t.text.src || '', // ten rieng co the khong co ban dich -> fallback ve src
        background: t.background || null,
      }));

      return { regions };
    },

    // ===== Webtoon dai (5.7) — cat lat + goi rieng tung lat + ghep lai =====
    // Chi dung khi naturalHeight > CFG.TILE_MAX_H (xem translateAndRenderImage).
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
      // Goi TUAN TU (khong Promise.all) - dung 1 job dang chiem CONCURRENCY
      // cua Queue roi, goi song song nhieu lat se vuot qua gia dinh 4GB
      // VRAM / 1 request tai 1 thoi diem da xac nhan o Giai doan B.
      for (const tile of tiles) {
        const result = await this.translateImage(tile.blob);
        // Cong offset y cua lat vao bbox tra ve de quy ve toa do ANH GOC
        // (tung lat duoc gui nhu 1 anh doc lap, bbox tra ve la toa do
        // CUC BO trong lat do).
        for (const r of result.regions) {
          allRegions.push({ ...r, y: r.y + tile.yOffset });
        }
      }
      // Bong thoai vat qua duong cat (nam trong vung chong lan) xuat hien
      // 2 lan (1 lan/lat) - loai theo IoU > 0.5, giu bbox lon hon (spec 5.7).
      return { regions: dedupeRegions(allRegions) };
    },
  };

  // ===== TileProcessor — cat anh cao thanh nhieu lat bang canvas (5.7) =====
  // Dung Blob da tai qua GM_xmlhttpRequest (KHONG PHAI <img> cua trang) de
  // ve len canvas - tranh tainted canvas (anh cross-origin ve tu <img> se
  // lam getImageData()/toBlob() nem SecurityError, xem 5.7/cam bay).
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
      if (size <= CFG.FONT_MIN && CFG.DEBUG) {
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

  // ===== Job — tai + dich + ve overlay cho 1 anh (dung chung cho Queue) =====
  const state = { total: 0, done: 0, errors: 0 };
  // Luu loi chi tiet de nguoi dung bam nut xem lai (C4: "Loi - click xem"
  // - spec goc nghi cho 1 anh, o day gop thanh danh sach vi co nhieu anh).
  const errorLog = [];

  async function translateAndRenderImage(img) {
    // Da co overlay roi (vd trung lap enqueue) -> bo qua, khong tinh loi.
    if (imgLayers.has(img)) return;
    // v0.38: do thoi gian TAM THOI tung buoc (v0.37 da xac nhan
    // computeRegionComplexity KHONG con la diem nghen - 34ms/14 vung -
    // nhung nguoi dung van thay UI hien chu cham vai giay sau khi console
    // da log "finished". Can biet chinh xac thoi gian roi vao dau: tai
    // anh goc, hash, GOI BACKEND (bao gom ca thoi gian truyen response
    // qua mang - co the la thu pham THAT vi background base64 cua 14-25
    // vung cong lai co the vai tram KB-vai MB), JSON.parse() phan
    // finalPayload trong normalizeResponse (nam trong khoang "backend"
    // do o day), Cache.set() (GM_setValue voi payload lon co the cham
    // tren Coc Coc - da thay IPC rieng cua no cham hon Chromium thuong o
    // vu chrome.userScripts truoc day), hay OverlayRenderer.render()
    // (tao DOM). Xoa toan bo khoi log nay sau khi xac dinh duoc nguyen
    // nhan that.
    const tStart = performance.now();
    try {
      const blob = await ApiAdapter.downloadImageBlob(img);
      const tDownload = performance.now();
      const hash = await Cache.hashBlob(blob);
      const tHash = performance.now();
      let result = Cache.get(hash);
      let tBackend = tHash;
      if (result) {
        log('Cache HIT:', hash, img.currentSrc || img.src);
      } else {
        log('Cache MISS, goi backend:', hash, img.currentSrc || img.src);
        // Webtoon dai (5.7): anh cao hon TILE_MAX_H phai cat lat truoc khi
        // gui, neu khong se cham gioi han canvas/OOM inpaint (xem cam bay).
        result =
          img.naturalHeight > CFG.TILE_MAX_H
            ? await ApiAdapter.translateImageTiled(blob, img.naturalWidth, img.naturalHeight)
            : await ApiAdapter.translateImage(blob);
        tBackend = performance.now();
        Cache.set(hash, result);
      }
      const tCacheSet = performance.now();
      // Do do phuc tap TU ANH DA INPAINT (r.background - khong luu vao
      // cache, chi anh huong cach render, khong phai du lieu dich) de biet
      // vung nao nen bo qua lop nen inpaint (xem CFG.BUSY_STD_THRESHOLD).
      const busyFlags = await computeRegionComplexity(result.regions);
      const tComplexity = performance.now();
      result.regions.forEach((r, i) => {
        r.busy = busyFlags[i];
      });
      await OverlayRenderer.render(img, result.regions);
      const tRender = performance.now();
      log(
        `DEBUG timing (${result.regions.length} vung): tai anh=${(tDownload - tStart).toFixed(0)}ms` +
          ` | hash=${(tHash - tDownload).toFixed(0)}ms` +
          ` | goi backend (bao gom nhan response qua mang)=${(tBackend - tHash).toFixed(0)}ms` +
          ` | Cache.set=${(tCacheSet - tBackend).toFixed(0)}ms` +
          ` | computeRegionComplexity=${(tComplexity - tCacheSet).toFixed(0)}ms` +
          ` | render DOM=${(tRender - tComplexity).toFixed(0)}ms` +
          ` | TONG=${(tRender - tStart).toFixed(0)}ms`
      );
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

  // ===== UI =====
  GM_addStyle(`
    /* Vi tri/kich thuoc that (left/top/width/height) dat truc tiep bang
       inline style tu positionLayer() - layer la con truc tiep cua
       <body>, KHONG con la con cua <img>/wrap nua (xem OverlayRenderer.render()). */
    .mot-layer { position: absolute; pointer-events: none; }

    /* Lop nen: anh da inpaint, dat dung khit bbox goc, khong bo tron/khong vien. */
    .mot-bg {
      position: absolute;
      background-size: 100% 100%;
      background-repeat: no-repeat;
      pointer-events: none;
    }

    /* Lop chu: mac dinh TRONG SUOT, chi co chu noi len tren (dung khi da
       co nen inpaint sach o PASS 1). */
    .mot-textbox {
      position: absolute;
      display: flex; align-items: center; justify-content: center;
      pointer-events: auto;
      box-sizing: border-box;
    }
    /* Vung "busy" (khong co nen inpaint - xem computeRegionComplexity):
       them nen trang mo + do bong de chu dich noi bat ro rang tren tranh
       goc nhieu mau/chi tiet, khong chi dua vao vien trang cua .mot-text. */
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
      /* Vien trang quanh chu (paint-order dat vien duoi lop fill) - doc
         duoc du nen ben duoi la gi (trang, den, hoa tiet...). */
      -webkit-text-stroke: 4px #fff;
      paint-order: stroke fill;
    }
    .mot-overflow { outline: 2px solid red; }
  `);

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
    GM_registerMenuCommand('Dịch trang này (Alt+D)', onTriggerTranslate);
    watchImages();
    log('San sang. Alt+D hoac menu Tampermonkey (icon tren thanh cong cu) de dich, Alt+T de bat/tat overlay.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
