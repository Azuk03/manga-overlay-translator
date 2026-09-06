// Task 6 (spec 2026-09-05-split-phase-pipeline): do 2 thu can do, ca hai qua
// backend THAT (container manga_translator), khong qua extension:
//
//  1. TUONG DUONG (equivalence) — Pha A (`translator:'none'` + inpainter that,
//     endpoint CU khong doi) co tra ve CUNG so vung, CUNG toa do, CUNG text
//     NGUON voi duong cu 1-lan-goi (`translator:'chatgpt'`) khong. Ban dich
//     (`dst`) bi LOAI khoi so sanh vi GPT nondeterministic — dung tien le da
//     dung o docs/superpowers/plans/2026-08-09-backend-context-relay-optimization.md.
//
//  2. THOI GIAN — do rieng Pha A va duong cu, nhieu lan/anh, de doc so tu
//     danh gia claim thiet ke "max(A,B) thay vi A+B" — KHONG tu suy ra so
//     end-to-end (can trinh duyet that dieu khien extension, xem task-6-report.md).
//
// KY LUAT DO (da tung sai trong du an nay — xem docs.md muc 8):
//  - Backend chi co 1 GPU executor (CONCURRENCY:1). KHONG BAO GIO chay 2 tien
//    trinh do nay CUNG LUC — request se xep hang sau nhau, lam so lieu sai.
//    Script nay tu no cung chi bao gio co 1 fetch bay cung luc (await tuan tu).
//  - Luon kiem `res.ok` truoc khi doc frame — harness cu bo qua cai nay va bao
//    nham "khong co frame ket qua" cho cai THAT RA la loi HTTP.
//  - Dung endpoint `/translate/with-form/json/stream` (multipart), KHONG PHAI
//    `/translate/json/stream` (JSON body).
//
// Dung:
//   node tools/measure-pipeline.js equivalence <outFile.json> <path...>
//   node tools/measure-pipeline.js timing <outFile.json> <repeats> <path...>
// <path...> la file anh hoac thu muc (thu muc duoc duyet + sap xep theo ten).

const fs = require('fs');
const path = require('path');

const BACKEND = process.env.MOT_BACKEND || 'http://127.0.0.1:5003';

// Khong doi theo rang buoc cua plan (xem docs.md 5.9/8): DETECTION_SIZE=2400,
// inpainter lama_mpe/1024 — dung dung gia tri content.js/phase-payload.js dang
// gui that (xem motPhaseAConfig() trong extension/content-script/phase-payload.js).
const DETECTION_SIZE = 2400;
const INPAINTER = 'lama_mpe';
const INPAINTING_SIZE = 1024;
const GPT_CONFIG_PATH = '/app/gpt_config-vi.yaml';

// Pha A: translator 'none' — KHONG goi GPT, nhung VAN chay inpainter that (khac
// voi detect-only cua boundary-stitch, noi inpainter bi tat 'none' — xem
// ApiAdapter.translateImage() content.js:474).
function phaseAConfig() {
  return {
    detector: { detection_size: DETECTION_SIZE },
    translator: { translator: 'none', target_lang: 'VIN' },
    inpainter: { inpainter: INPAINTER, inpainting_size: INPAINTING_SIZE },
    render: { renderer: 'none' },
  };
}

// Duong CU (truoc split-phase): 1 lan goi lam het detect+OCR+dich GPT+inpaint.
// Giong het nhanh khong-detectOnly cua ApiAdapter.translateImage() truoc khi
// co split-phase.
function oldPathConfig() {
  return {
    detector: { detection_size: DETECTION_SIZE },
    translator: { translator: 'chatgpt', target_lang: 'VIN', gpt_config: GPT_CONFIG_PATH },
    inpainter: { inpainter: INPAINTER, inpainting_size: INPAINTING_SIZE },
    render: { renderer: 'none' },
  };
}

// Frame: [1 byte status][4 byte len BE][payload]. status 0 = ket qua cuoi cung,
// status 2 = loi, status 1 = tien do (ten buoc dang chay).
function parseFrames(buf) {
  const out = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    const status = buf[i];
    const len = buf.readUInt32BE(i + 1);
    out.push({ status, payload: buf.subarray(i + 5, i + 5 + len) });
    i += 5 + len;
  }
  return out;
}

async function callBackend(imgPath, config) {
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(imgPath)]), path.basename(imgPath));
  fd.append('config', JSON.stringify(config));

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${BACKEND}/translate/with-form/json/stream`, { method: 'POST', body: fd });
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: 'fetch throw: ' + e.message };
  }
  if (!res.ok) {
    // Bai hoc tu detect_sweep.js: bo qua check nay se bao nham "khong co frame
    // ket qua" cho cai THAT RA la loi HTTP (vd config sai truong -> 422).
    const text = await res.text().catch(() => '');
    return { ok: false, ms: Date.now() - t0, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = Date.now() - t0;

  const frames = parseFrames(buf);
  const result = frames.find((f) => f.status === 0);
  if (!result) {
    const err = frames.find((f) => f.status === 2);
    return {
      ok: false,
      ms,
      error: err ? err.payload.toString('utf8').slice(0, 300) : 'khong co frame ket qua (status 0)',
    };
  }
  const json = JSON.parse(result.payload.toString('utf8'));
  // Chi lay TOA DO + text NGUON. Bo qua `dst` (ban dich) hoan toan o day —
  // day chinh la diem loai-tru GPT khoi so sanh tuong duong.
  const regions = (json.translations || []).map((t) => ({
    minX: t.minX,
    minY: t.minY,
    maxX: t.maxX,
    maxY: t.maxY,
    src: (t.text && typeof t.text.src === 'string' ? t.text.src : '').replace(/\s+/g, ' ').trim(),
  }));
  regions.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
  return { ok: true, ms, n: regions.length, regions };
}

function expandPaths(paths) {
  const IMG_RE = /\.(png|jpe?g|webp|avif)$/i;
  const out = [];
  for (const p of paths) {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      const files = fs
        .readdirSync(p)
        .filter((f) => IMG_RE.test(f))
        .sort()
        .map((f) => path.join(p, f));
      out.push(...files);
    } else {
      out.push(p);
    }
  }
  return out;
}

function regionKey(r) {
  return `${r.minX},${r.minY},${r.maxX},${r.maxY}|${r.src}`;
}

// So sanh 2 tap vung: khop CHINH XAC toa do + text nguon (KHONG so dst). Tra ve
// chi tiet cu the (vung nao chi co o 1 ben) thay vi chi true/false, vi brief
// yeu cau "report ... any mismatch concretely".
function compareRegions(a, b) {
  const setA = a.map(regionKey);
  const setB = b.map(regionKey);
  const onlyInPhaseA = setA.filter((k) => !setB.includes(k));
  const onlyInOldPath = setB.filter((k) => !setA.includes(k));
  return {
    pass: onlyInPhaseA.length === 0 && onlyInOldPath.length === 0 && a.length === b.length,
    countPhaseA: a.length,
    countOldPath: b.length,
    onlyInPhaseA,
    onlyInOldPath,
  };
}

async function runEquivalence(outFile, images) {
  console.log(`EQUIVALENCE: ${images.length} anh, moi anh 1 lan Pha A + 1 lan duong cu, TUAN TU.`);
  const rows = [];
  let passCount = 0;
  let failCount = 0;
  let errorCount = 0;
  for (const img of images) {
    const name = path.basename(img);
    process.stdout.write(`${name}: Pha A... `);
    const a = await callBackend(img, phaseAConfig());
    if (!a.ok) {
      console.log(`LOI (${a.error})`);
      rows.push({ img: name, ok: false, stage: 'phaseA', error: a.error });
      errorCount++;
      continue;
    }
    process.stdout.write(`${a.n} vung, ${a.ms}ms. Duong cu... `);
    const o = await callBackend(img, oldPathConfig());
    if (!o.ok) {
      console.log(`LOI (${o.error})`);
      rows.push({ img: name, ok: false, stage: 'oldPath', error: o.error });
      errorCount++;
      continue;
    }
    const cmp = compareRegions(a.regions, o.regions);
    if (cmp.pass) {
      passCount++;
      console.log(`${o.n} vung, ${o.ms}ms -> KHOP`);
    } else {
      failCount++;
      console.log(`${o.n} vung, ${o.ms}ms -> LECH (Pha A=${cmp.countPhaseA}, duong cu=${cmp.countOldPath})`);
    }
    rows.push({
      img: name,
      ok: true,
      phaseA: { ms: a.ms, n: a.n, regions: a.regions },
      oldPath: { ms: o.ms, n: o.n, regions: o.regions },
      compare: cmp,
    });
  }
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
  console.log(`\nDa ghi ${outFile} (${rows.length} dong).`);
  console.log(`Tong: ${images.length} anh | KHOP: ${passCount} | LECH: ${failCount} | LOI: ${errorCount}`);
  return rows;
}

async function runTiming(outFile, repeats, images) {
  console.log(
    `TIMING: ${images.length} anh x 2 dieu kien x ${repeats} lan = ${images.length * 2 * repeats} luot goi, TUAN TU.`
  );
  const rows = [];
  let okCount = 0;
  let errCount = 0;
  for (const img of images) {
    const name = path.basename(img);
    for (const [cond, cfgFn] of [
      ['phaseA', phaseAConfig],
      ['oldPath', oldPathConfig],
    ]) {
      for (let r = 0; r < repeats; r++) {
        const res = await callBackend(img, cfgFn());
        if (res.ok) {
          okCount++;
          console.log(`${name} ${cond} #${r}: ${res.ms}ms, ${res.n} vung`);
        } else {
          errCount++;
          console.log(`${name} ${cond} #${r}: LOI ${res.error}`);
        }
        rows.push({ img: name, cond, run: r, ...res });
      }
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
  console.log(`\nDa ghi ${outFile} (${rows.length} dong).`);
  console.log(`Tong luot goi: ${rows.length} | OK: ${okCount} | LOI: ${errCount}`);
  return rows;
}

function usage() {
  console.error('Dung: node measure-pipeline.js equivalence <outFile.json> <path...>');
  console.error('      node measure-pipeline.js timing <outFile.json> <repeats> <path...>');
  process.exit(1);
}

async function main() {
  const [, , mode, ...rest] = process.argv;
  if (mode === 'equivalence') {
    const [outFile, ...paths] = rest;
    if (!outFile || paths.length === 0) usage();
    await runEquivalence(outFile, expandPaths(paths));
  } else if (mode === 'timing') {
    const [outFile, repeatsStr, ...paths] = rest;
    if (!outFile || !repeatsStr || paths.length === 0) usage();
    await runTiming(outFile, Number(repeatsStr), expandPaths(paths));
  } else {
    usage();
  }
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
