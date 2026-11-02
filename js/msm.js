/*
 * Dance Next Now — leitor e avaliador de classificadores MSM (MoveSpace).
 *
 * Port em JavaScript do algoritmo de scoring do JustDanceEditor
 * (https://github.com/MrKev312/JustDanceEditor, projeto JustDanceEditor.Scoring),
 * de MrKev312 e colaboradores, licenciado sob GPL-3.0. Este arquivo também é
 * distribuído sob a GPL-3.0 (veja LICENSE na raiz do projeto).
 *
 * Entrada: amostras do acelerômetro do celular em "g" (aceleração com gravidade).
 */

// ------------------------------------------------------------------ leitura do .msm
const MEASURE = { AX_DEV_DIR: 50, AY_DEV_DIR: 51, AZ_DEV_DIR: 52, ACCEL_NORM_AVG: 56, ACCEL_DEV_NORM_AVG: 61 };
const isDirection = id => id === 50 || id === 51 || id === 52;

/** Lê um classificador .msm (versões 4–7, little ou big-endian). */
export function readClassifier(buffer) {
  const dv = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
  let le;
  if (dv.getUint32(0, true) === 1) le = true;
  else if (dv.getUint32(0, false) === 1) le = false;
  else throw new Error('marcador de endianness desconhecido');
  let o = 4;
  const u32 = () => { const v = dv.getUint32(o, le); o += 4; return v; };
  const i32 = () => { const v = dv.getInt32(o, le); o += 4; return v; };
  const f32 = () => { const v = dv.getFloat32(o, le); o += 4; return v; };
  const str = n => { const b = new Uint8Array(dv.buffer, dv.byteOffset + o, n); o += n; const z = b.indexOf(0); return new TextDecoder().decode(z < 0 ? b : b.subarray(0, z)); };
  const floats = n => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = f32(); return a; };

  const version = u32();
  if (version < 4 || version > 7) throw new Error(`MSM versão ${version} não suportada`);
  const moveName = str(64), songName = str(64), measureSetName = str(64);
  const duration = f32(), lowThreshold = f32(), highThreshold = f32();
  let autoCorrelationThreshold = -1, directionImpactFactor = -1;
  if (version >= 7) { autoCorrelationThreshold = f32(); directionImpactFactor = f32(); }
  const bitsLo = le ? u32() : 0, bitsHi = u32(), bitsLo2 = le ? 0 : u32();
  const measureSetBits = [bitsHi, le ? bitsLo : bitsLo2];
  const customizationBitField = version >= 5 ? u32() : 0;
  const scoringAlgorithmType = i32();
  const energyMeansCount = u32();
  const subClassifiersCount = u32();
  if (scoringAlgorithmType === -2147483648) throw new Error('quantidade de medidas inválida');
  const measureCount = Math.abs(scoringAlgorithmType);
  const covarianceCount = scoringAlgorithmType > 0 ? measureCount : measureCount * (measureCount + 1) / 2;
  const means = floats(measureCount);
  const invCov = floats(covarianceCount);
  const energyMeans = floats(energyMeansCount);
  return {
    version, moveName, songName, measureSetName, duration, lowThreshold, highThreshold,
    autoCorrelationThreshold, directionImpactFactor, measureSetBits, customizationBitField,
    scoringAlgorithmType, means, invCov, energyMeans, subClassifiersCount,
  };
}

// ------------------------------------------------------------------ análise do sinal
const SAFETY = 0.01667;              // margem no começo/fim do move (em fração)
const USABLE = 1 - 2 * SAFETY;

function partsCount(c) {
  if (c.version === 4 || c.version === 5) return 10;
  const p = Math.floor(c.duration * 30 / 2.49);
  if (!(p >= 1 && p < 256)) throw new Error(`duração ${c.duration} inválida para o MSM`);
  return p;
}

/**
 * Reproduz o MoveSpaceState: sinais derivados (derivada, norma, média) e
 * medidas por parte do move. samples: [{p: 0..1, x, y, z}] em ordem.
 */
function analyze(samples, parts, gameDuration, smoothingHz = 60, saturation = 3.4) {
  const clampA = v => (Number.isNaN(v) ? 0 : Math.max(-saturation, Math.min(saturation, v)));
  // estado dos sinais
  const S = {
    p: 0, ax: 0, ay: 0, az: 0,
    dx: { v: 0, has: false, pv: 0, pp: 0 }, dy: { v: 0, has: false, pv: 0, pp: 0 }, dz: { v: 0, has: false, pv: 0, pp: 0 },
  };
  const avg = () => ({ sum: 0, n: 0, v: 0 });
  const A = { dx: avg(), dy: avg(), dz: avg(), norm: avg(), devNorm: avg() };
  const order = [['dx', MEASURE.AX_DEV_DIR], ['dy', MEASURE.AY_DEV_DIR], ['dz', MEASURE.AZ_DEV_DIR], ['norm', MEASURE.ACCEL_NORM_AVG], ['devNorm', MEASURE.ACCEL_DEV_NORM_AVG]];
  const partLen = USABLE / parts;
  const measures = [];
  for (const [src, id] of order)
    for (let k = 1; k <= parts; k++) {
      const start = SAFETY + partLen * (k - 1);
      measures.push({ id, part: k, src, start, end: start + partLen, started: false, value: 0 });
    }
  const autoCorr = [];
  let first = true;

  const deriv = (d, value, isFirst) => {
    if (isFirst) { d.pv = value; d.pp = S.p; d.has = false; return; }
    const dp = S.p - d.pp;
    if (!(dp > 0) || !Number.isFinite(dp)) { d.pv = value; d.pp = S.p; d.has = false; return; }
    d.v = (value - d.pv) / dp; d.pv = value; d.pp = S.p; d.has = true;
  };
  const addAvg = (a, has, v) => { if (!has) return; a.sum += v; a.n++; a.v = a.sum / a.n; };

  const update = (p, x, y, z) => {
    S.p = p; S.ax = x; S.ay = y; S.az = z;
    // ordem dos sinais igual ao original
    deriv(S.dx, x, first); addAvg(A.dx, S.dx.has, S.dx.v);
    deriv(S.dy, y, first); addAvg(A.dy, S.dy.has, S.dy.v);
    deriv(S.dz, z, first); addAvg(A.dz, S.dz.has, S.dz.v);
    const norm = Math.hypot(x, y, z);
    addAvg(A.norm, true, norm);                                  // norma da aceleração sempre tem valor
    const devHas = S.dx.has && S.dy.has && S.dz.has;
    addAvg(A.devNorm, devHas, devHas ? Math.hypot(S.dx.v, S.dy.v, S.dz.v) : 0);
    autoCorr.push({ t: p * gameDuration, n: norm });
    for (const m of measures) {
      // no primeiro update só a medida de norma (sinal "base") é atualizada
      if (first && m.src !== 'norm') continue;
      if (p >= m.start && p <= m.end) {
        const a = A[m.src];
        if (!m.started) {
          m.started = true;
          // reinicia a média e reaplica o valor atual da fonte
          a.sum = 0; a.n = 0; a.v = 0;
          const has = m.src === 'norm' ? true : m.src === 'devNorm' ? devHas : S[m.src].has;
          const cur = m.src === 'norm' ? norm : m.src === 'devNorm' ? (devHas ? Math.hypot(S.dx.v, S.dy.v, S.dz.v) : 0) : S[m.src].v;
          addAvg(a, has, cur);
        }
        m.value = a.v;
      }
    }
    first = false;
  };

  // suavização: média das amostras em passos de 1/(duração*60 Hz)
  let freq = smoothingHz, next = 1 / (gameDuration * smoothingHz), cnt = 0, sx = 0, sy = 0, sz = 0;
  for (const s of samples) {
    if (s.p < 0 || s.p > 1) continue;
    const x = clampA(s.x), y = clampA(s.y), z = clampA(s.z);
    if (freq === -1) { update(s.p, x, y, z); continue; }
    if (s.p > next) {
      const step = 1 / (gameDuration * freq);
      if (s.p > next + step || cnt === 0) { freq = -1; update(s.p, x, y, z); }
      else {
        update(next - 0.5 * step, sx / cnt, sy / cnt, sz / cnt);
        next += step; cnt = 0; sx = sy = sz = 0;
      }
    }
    if (freq !== -1) { cnt++; sx += x; sy += y; sz += z; }
  }

  // médias de energia
  let nSum = 0, nN = 0, dSum = 0, dN = 0;
  for (const m of measures) {
    if (m.id === MEASURE.ACCEL_NORM_AVG) { nSum += m.value; nN++; }
    else if (m.id === MEASURE.ACCEL_DEV_NORM_AVG) { dSum += m.value; dN++; }
  }
  const energy = [];
  if (nN) energy.push(nSum / nN);
  if (dN) energy.push(dSum / dN);
  return { measures, energy, autoCorr };
}

// ------------------------------------------------------------------ nota de um move
export const DEFAULTS = {
  lowThreshold: 1.0, highThreshold: 3.5,          // perfil JD Next
  autoCorrelationThreshold: 0.7, directionImpactFactor: 1.0,
  smoothingHz: 60, saturation: 3.4,
  energyAmountRatio: 0.1, energyFactorRatio: 0.667,
  acStep: 0.02, acMax: 0.5,
};
const clamp = (v, a, b) => (Number.isNaN(v) ? a : v < a ? a : v > b ? b : v);
const finite = (v, fb) => (Number.isFinite(v) ? v : fb);

function runtimeSettings(c, o) {
  const low = clamp(c.lowThreshold === -1 ? o.lowThreshold : c.lowThreshold, 0.4, 1.4);
  const high = clamp(c.highThreshold === -1 ? o.highThreshold : c.highThreshold, 1.5, 6.0);
  const ac = clamp(c.autoCorrelationThreshold === -1 ? o.autoCorrelationThreshold : c.autoCorrelationThreshold, 0.5, 1.3);
  let bits = c.customizationBitField >>> 0;
  if (ac === 1.3) bits |= 2;
  const dir = clamp(c.directionImpactFactor === -1 ? o.directionImpactFactor : c.directionImpactFactor, 0, 1);
  if (dir === 0) bits |= 1;
  return { low, high, ac, dir, bits };
}

function statisticalDistance(c, measures) {
  if (c.scoringAlgorithmType === 0) return -1;
  let used = 0, sq = 0;
  if (c.scoringAlgorithmType > 0) {
    measures.forEach((m, i) => {
      if (isDirection(m.id)) return;
      const d = m.value - c.means[i];
      sq += d * d * c.invCov[i]; used++;
    });
  } else {
    const dev = measures.map((m, i) => (isDirection(m.id) ? 0 : (used++, m.value - c.means[i])));
    let k = 0;
    for (let r = 0; r < dev.length; r++)
      for (let col = r; col < dev.length; col++) {
        let v = dev[r] * dev[col] * c.invCov[k++];
        if (col > r) v *= 2;
        sq += v;
      }
  }
  return used ? Math.sqrt(sq / used) : -1;
}

function autoCorrelationTime(samples, threshold, bits, o) {
  if ((bits & 2) || threshold === -1) return -6;
  if (samples.length < 2) return -7;
  const mean = samples.reduce((s, a) => s + a.n, 0) / samples.length;
  const c = samples.map(s => ({ t: s.t, n: s.n - mean }));
  const integral = shift => {
    let si = 0;
    if (shift > 0) {
      const last = c.length - 1;
      while (si !== last) { if (c[si].t > shift) break; si++; }
      if (si === last) return -1;
    }
    let bi = 0;
    let pp = c[bi].n * c[si].n, pt = 0.5 * (c[bi].t + c[si].t);
    bi++; si++;
    let integ = 0, total = 0;
    while (si !== c.length) {
      const cp = c[bi].n * c[si].n, ct = 0.5 * (c[bi].t + c[si].t), dt = ct - pt;
      integ += 0.5 * (pp + cp) * dt; total += dt;
      pp = cp; pt = ct; bi++; si++;
    }
    return integ / total;
  };
  const base = integral(0);
  if (base === -1) return -7;
  let minRatio = 1e32;
  for (let shift = o.acStep; shift < o.acMax + 0.001; shift += o.acStep) {
    const s = integral(shift);
    if (s === -1) return -8;
    const ratio = s / base;
    if (ratio < minRatio) minRatio = ratio;
    if (minRatio < 0 && ratio > threshold) return shift;
  }
  return -9;
}

function directionImpact(c, measures, rt) {
  if (rt.bits & 1) return { ignored: true, impact: 0 };
  const parts = measures.reduce((m, x) => Math.max(m, x.part), 0);
  if (!parts) return { ignored: true, impact: 0 };
  const P = Array.from({ length: parts }, () => ({}));
  let count = 0;
  measures.forEach((m, i) => {
    if (!isDirection(m.id)) return;
    count++;
    const axis = m.id === 50 ? 'x' : m.id === 51 ? 'y' : 'z';
    Object.assign(P[m.part - 1], { ['r' + axis]: m.value, ['m' + axis]: c.means[i], ['i' + axis]: c.invCov[i] });
  });
  if (count !== 3 * parts) return { ignored: true, impact: 0 };
  const dist = (p, inv) => {
    const s = inv ? -1 : 1;
    return ((s * p.rx - p.mx) ** 2 * p.ix + (s * p.ry - p.my) ** 2 * p.iy + (s * p.rz - p.mz) ** 2 * p.iz) / 3;
  };
  let tendency = 0;
  for (const p of P) {
    const t = Math.sqrt(dist(p, true)) - Math.sqrt(dist(p, false));
    if (t > 0) tendency++; else if (t < 0) tendency--;
  }
  return { ignored: false, impact: tendency / parts * rt.dir };
}

/**
 * Avalia um move. samples: [{p (0..1 dentro da janela), x, y, z}] em g.
 * Retorna {ratio, energyAmount, energyFactor, autoCorrelationTime, dirIgnored, dirImpact}.
 */
export function scoreMove(classifier, samples, gameDuration, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const c = classifier;
  const rt = runtimeSettings(c, o);
  const a = analyze(samples, partsCount(c), gameDuration, o.smoothingHz, o.saturation);
  const distance = finite(statisticalDistance(c, a.measures), -1);
  const ratio = rt.low === -1 || rt.high === -1 || distance < 0 ? 0 : clamp((distance - rt.high) / (rt.low - rt.high), 0, 1);
  const e = a.energy, ce = c.energyMeans;
  const energyAmount = e.length < 2 ? -1 : finite((1 - o.energyAmountRatio) * Math.max(0, e[0] - 1) + o.energyAmountRatio * e[1], 0);
  const energyFactor = e.length < 2 || ce.length < 2 ? -1 : finite((1 - o.energyFactorRatio) * (e[0] / ce[0]) + o.energyFactorRatio * (e[1] / ce[1]), 0);
  const act = finite(autoCorrelationTime(a.autoCorr, rt.ac, rt.bits, o), -9);
  let { ignored, impact } = directionImpact(c, a.measures, rt);
  if (!Number.isFinite(impact)) { ignored = true; impact = 0; }
  return { distance, ratio, energyAmount, energyFactor, autoCorrelationTime: act, dirIgnored: ignored, dirImpact: impact };
}

// ------------------------------------------------------------------ perfil JD Next (nota final do move)
const OK = 0.25, CHARITY_OK = 0.05, PERFECT = 0.9, SUPER = 0.75, GOOD = 0.5;

/** Converte o resultado bruto na fração 0..1 usada para feedback e pontos (perfil JD Next). */
export function finalMoveRatio(r) {
  const ratio = clamp(finite(r.ratio, 0), 0, 1);
  let s = Math.min(ratio * 1.09, 1);
  const ea = finite(r.energyAmount, 0), ef = finite(r.energyFactor, 0), di = finite(r.dirImpact, 0);
  let charity = true;
  if (s < OK) s = 0;
  else if (ea < 0.25) { s = 0; charity = false; }               // não se mexeu
  else if (r.autoCorrelationTime > 0) s = Math.min(s, 0.4);      // chacoalhou o celular
  else if (!r.dirIgnored) {
    if (di < 0) { s += di * 0.5; if (s < OK) s = 0; }
    else if (di > 0) s = Math.min(s + di * 0.2, 1);
  }
  if (s < CHARITY_OK) { if (charity && ef >= 0.6) s = CHARITY_OK; }
  else if (s >= PERFECT && ef < 0.4) s = SUPER - 0.01;           // pouca energia não ganha PERFECT
  return clamp(s, 0, 1);
}

/** 0 X, 1 OK, 2 GOOD, 3 SUPER, 4 PERFECT, 5 YEAH */
export function feedbackFor(ratio, gold) {
  if (gold) return ratio >= GOOD ? 5 : 0;
  if (ratio >= PERFECT) return 4;
  if (ratio >= SUPER) return 3;
  if (ratio >= GOOD) return 2;
  if (ratio >= OK || Math.abs(ratio - CHARITY_OK) < 1e-4) return 1;
  return 0;
}

// ------------------------------------------------------------------ eixos do celular
/**
 * JD Now: gira as amostras do celular 30° e aplica a curva não linear do app.
 * Usado no perfil de eixos "jdnow". max guarda o maior valor positivo visto.
 */
export function jdNowTransform(s, state) {
  const cos = Math.cos(Math.PI / 6), sin = Math.sin(Math.PI / 6);
  state.max = Math.max(state.max ?? 2, s.x, s.y, s.z);
  let x = cos * s.x - (-s.y) * sin, y = -s.z, z = (-s.y) * cos + sin * s.x;
  if (state.max < 3.4) {
    const nl = v => { const a = Math.abs(v); return a <= 1 ? v : ((a - 1) * 0.5111111402511597 / 1.25 + 1) * v; };
    x = nl(x); y = nl(y); z = nl(z);
  }
  return { t: s.t, x: clamp(x, -3.4, 3.4), y: clamp(y, -3.4, 3.4), z: clamp(z, -3.4, 3.4) };
}

/** Pacote moves.bin + índice {nome: [offset, tamanho]} → Map nome→classificador. */
export function readMoveBank(arrayBuffer, index) {
  const bank = new Map();
  for (const [name, [off, len]] of Object.entries(index || {})) {
    try { bank.set(name.toLowerCase(), readClassifier(new DataView(arrayBuffer, off, len))); }
    catch (e) { console.warn('MSM ignorado', name, e.message); }
  }
  return bank;
}

// usado pelos testes e pelo gerador de classificadores sintéticos
export const _internal = { analyze, partsCount };
