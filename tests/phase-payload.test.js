// Test cho phan dung request cua pha A / pha B.
//
// Chay: node --test tests/*.test.js   (node >= 18; xem Global Constraints)
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const SRC = path.join(__dirname, '..', 'extension', 'content-script', 'phase-payload.js');
const { motPhaseAConfig, motPhaseBBody } = new Function(
  `${fs.readFileSync(SRC, 'utf8')}\nreturn { motPhaseAConfig, motPhaseBBody };`
)();

const CFG = {
  DETECTION_SIZE: 2400,
  INPAINTER: 'lama_mpe',
  INPAINTING_SIZE: 1024,
  GPT_CONFIG_PATH: '/app/gpt_config-vi.yaml',
};

test('pha A dung translator none - khong duoc goi GPT', () => {
  assert.strictEqual(motPhaseAConfig(CFG).translator.translator, 'none');
});

test('pha A BAT inpaint that - khac han probe detect-only', () => {
  const c = motPhaseAConfig(CFG);
  assert.strictEqual(c.inpainter.inpainter, 'lama_mpe');
  assert.strictEqual(c.inpainter.inpainting_size, 1024);
});

test('pha A giu detection_size 2400', () => {
  assert.strictEqual(motPhaseAConfig(CFG).detector.detection_size, 2400);
});

test('pha A khong tu render - overlay do client ve', () => {
  assert.strictEqual(motPhaseAConfig(CFG).render.renderer, 'none');
});

test('pha B gui dung cac chuoi, dung thu tu', () => {
  const b = motPhaseBBody({ texts: ['A', 'B'], targetLang: 'VIN', engine: 'chatgpt' });
  assert.deepStrictEqual(b.texts, ['A', 'B']);
});

test('pha B gui gpt_config khi engine la chatgpt', () => {
  const b = motPhaseBBody({ texts: ['A'], targetLang: 'VIN', engine: 'chatgpt', gptConfigPath: '/app/gpt_config-vi.yaml' });
  assert.strictEqual(b.gpt_config, '/app/gpt_config-vi.yaml');
});

test('pha B KHONG gui gpt_config cho deepl (kien truc khac, khong doc gpt_config)', () => {
  const b = motPhaseBBody({ texts: ['A'], targetLang: 'VIN', engine: 'deepl', gptConfigPath: '/app/gpt_config-vi.yaml' });
  assert.strictEqual(b.gpt_config, undefined);
});

// Hai truong hop duoi day chot dieu kien gpt_config KHOP voi duong cu trong
// ApiAdapter.translateImage(): "VIN va khong phai deepl", KHONG phai "la chatgpt".
test('pha B VAN gui gpt_config cho gemini (cung ho GPT nhu chatgpt)', () => {
  const b = motPhaseBBody({ texts: ['A'], targetLang: 'VIN', engine: 'gemini', gptConfigPath: '/app/gpt_config-vi.yaml' });
  assert.strictEqual(b.gpt_config, '/app/gpt_config-vi.yaml');
});

test('pha B KHONG gui gpt_config khi dich sang ngon ngu khac VIN', () => {
  const b = motPhaseBBody({ texts: ['A'], targetLang: 'ENG', engine: 'chatgpt', gptConfigPath: '/app/gpt_config-vi.yaml' });
  assert.strictEqual(b.gpt_config, undefined);
});

test('pha B bo qua context rong thay vi gui mang rong', () => {
  const b = motPhaseBBody({ texts: ['A'], targetLang: 'VIN', engine: 'chatgpt', context: [] });
  assert.strictEqual(b.context, undefined);
});
