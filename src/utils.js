// ── Date helpers ─────────────────────────────────────────────
export const ROMAN = ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
export const INDO_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
export const PROVINCES = ['Kalimantan Timur','Kalimantan Selatan','Kalimantan Utara','Kalimantan Tengah','Sulawesi Tengah','Sulawesi Selatan','Papua'];

// ── Bank accounts ─────────────────────────────────────────────
export const BANK_ACCOUNTS = {
  USI: [
    { id:'usi-bca',     bank:'Bank Central Asia',    branch:'KCU Galaxy Surabaya',        account:'788 118 9899',      beneficiary:'PT United Shipping Indonesia' },
    { id:'usi-bri',     bank:'Bank Rakyat Indonesia', branch:'KC Kaliasin Surabaya',       account:'0096 0100 426 3306', beneficiary:'PT United Shipping Indonesia' },
    { id:'usi-permata', bank:'Bank Permata',          branch:'KC Tunjungan Surabaya',      account:'702 358 779',       beneficiary:'PT United Shipping Indonesia' },
  ],
  PPS: [
    { id:'pps-bca',     bank:'Bank Central Asia',    branch:'KCU Galaxy Surabaya',        account:'788 070 3662',      beneficiary:'PT Petroprima Sejahtera' },
    { id:'pps-maspion', bank:'Bank Maspion',          branch:'KC Basuki Rahmat Surabaya',  account:'1012 029 663',      beneficiary:'PT Petroprima Sejahtera' },
    { id:'pps-permata', bank:'Bank Permata',          branch:'KC Tunjungan Surabaya',      account:'702 358 590',       beneficiary:'PT Petroprima Sejahtera' },
  ],
};

export const INIT_PBBKB_RATES = {
  'Kalimantan Timur': 7.5, 'Kalimantan Selatan': 10,
  'Sulawesi Tengah': 7.5,  'Kalimantan Utara': 5,
  'Kalimantan Tengah': 5,  'Sulawesi Selatan': 5, 'Papua': 5,
};
// per-province: is PPS registered in Bapenda (allowed to collect PBBKB)?
export const INIT_PBBKB_ENABLED = {
  'Kalimantan Timur': true, 'Kalimantan Selatan': true,
  'Sulawesi Tengah': true,  'Kalimantan Utara': true,
  'Kalimantan Tengah': true,'Sulawesi Selatan': true, 'Papua': true,
};

export const uid     = () => Math.random().toString(36).slice(2, 9);
export const pad3    = n  => String(n).padStart(3, '0');
export const todayStr = () => new Date().toISOString().split('T')[0];

/** Auto-generate period string from a date.
 *  Day 1–14  → "1 – 14 Maret 2026"
 *  Day 15–31 → "15 – 31 Maret 2026"
 */
export function autoPeriod(dateStr) {
  if (!dateStr) return '';
  const d    = new Date(dateStr + 'T00:00:00');
  const day  = d.getDate();
  const mo   = INDO_MONTHS[d.getMonth()];
  const yr   = d.getFullYear();
  if (day <= 14) {
    return `1 – 14 ${mo} ${yr}`;
  } else {
    const last = new Date(yr, d.getMonth() + 1, 0).getDate();
    return `15 – ${last} ${mo} ${yr}`;
  }
}

export function zp(n) { return n < 10 ? '0' + n : '' + n; }

/** Indonesian number format: 14.730,50 */
export function idr(n, dp = 2) {
  if (n === null || n === undefined || isNaN(+n)) return '–';
  const s = Math.abs(+n).toFixed(dp);
  const [int, dec] = s.split('.');
  const fmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + (dp > 0 ? `${fmt},${dec}` : fmt);
}
export const idr0 = n => idr(n, 0);

export function indoDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${INDO_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function daysBetween(d1, d2) {
  return Math.max(1, Math.round((new Date(d2) - new Date(d1)) / 86400000));
}

// ── Price calculations ────────────────────────────────────────

/** Cost of Money: base × ((1 + rate)^(days/365) - 1) */
export function calcCoM(base, ratePct, days) {
  return base * (Math.pow(1 + ratePct / 100, days / 365) - 1);
}

/** Modal cost per litre for a single tranche — excludes CoM */
export function calcModalPerL(tranche, rates) {
  const { entity, basePrice, chargesBPH, province } = tranche;
  const pph  = basePrice * rates.pph / 100;
  const bph  = chargesBPH ? basePrice * rates.bph / 100 : 0;
  if (entity === 'USI') {
    // USI: PBBKB is already embedded in the purchase price from Pertamina
    const pbbkbRate = rates.pbbkbRates[province] ?? 7.5;
    return basePrice + basePrice * pbbkbRate / 100 + pph + bph;
  } else {
    // PPS: PBBKB collected separately — but only if registered in Bapenda for this province
    // If not registered (pbbkbEnabled = false), treat same as USI: embedded in buy price
    const registered = rates.pbbkbEnabled?.[province] !== false;
    if (!registered) {
      const pbbkbRate = rates.pbbkbRates[province] ?? 7.5;
      return basePrice + basePrice * pbbkbRate / 100 + pph + bph;
    }
    return basePrice + pph + bph;
  }
}

/** Volume-weighted blended modal across all tranches — excludes CoM */
export function blendedModal(tranches, rates) {
  if (!tranches || !tranches.length) return 0;
  let cost = 0, vol = 0;
  tranches.forEach(t => { cost += calcModalPerL(t, rates) * t.volume; vol += t.volume; });
  return vol ? cost / vol : 0;
}

/**
 * Weighted CoM across tranches at offering time.
 * Each tranche weighted by its cash outflow (modal × volume).
 * days_i = (offeringDate + TOP) - buyDate_i
 */
export function weightedCoM(tranches, rates, offeringDate, topDays) {
  if (!tranches || !tranches.length) return 0;
  let totalComCost = 0, totalVol = 0;
  const offerTs = new Date(offeringDate + 'T00:00:00').getTime();
  const paymentTs = offerTs + topDays * 86400000;

  tranches.forEach(t => {
    const buyTs  = new Date(t.buyDate + 'T00:00:00').getTime();
    const days   = Math.max(1, Math.round((paymentTs - buyTs) / 86400000));
    const modal  = calcModalPerL(t, rates);
    const com    = modal * (Math.pow(1 + rates.comRate / 100, days / 365) - 1);
    totalComCost += com * t.volume;
    totalVol     += t.volume;
  });
  return totalVol ? totalComCost / totalVol : 0;
}

// ── Letter number ─────────────────────────────────────────────
export function letterNo(entity, seq, revision, clientCode, dateStr) {
  const d   = new Date(dateStr + 'T00:00:00');
  const mo  = ROMAN[d.getMonth() + 1];
  const yr  = String(d.getFullYear()).slice(-2);
  const rev = revision > 0 ? `-R${revision}` : '';
  const n   = pad3(seq);
  return entity === 'USI'
    ? `${n}${rev}/USI/${clientCode}/${mo}/${yr}`
    : `QF-${n}${rev}/PPS/${clientCode}/${mo}/${yr}`;
}

// ── Initial DB structure ──────────────────────────────────────
export const INIT_DB = {
  rates: {
    ppn: 11, pph: 0.3, bph: 0.25, comRate: 10.7,
    pbbkbRates:   { ...INIT_PBBKB_RATES },
    pbbkbEnabled: { ...INIT_PBBKB_ENABLED },
  },
  clients: [],
  sites: [],
  cargoPositions: [],
  letterSeq: 0,
  letters: [],
  calculations: [],
  bankAccounts: {
    USI: [
      { id:'usi-bca',     bank:'Bank Central Asia',     branch:'KCU Galaxy Surabaya',       account:'788 118 9899',       beneficiary:'PT United Shipping Indonesia' },
      { id:'usi-bri',     bank:'Bank Rakyat Indonesia',  branch:'KC Kaliasin Surabaya',      account:'0096 0100 426 3306', beneficiary:'PT United Shipping Indonesia' },
      { id:'usi-permata', bank:'Bank Permata',            branch:'KC Tunjungan Surabaya',     account:'702 358 779',        beneficiary:'PT United Shipping Indonesia' },
    ],
    PPS: [
      { id:'pps-bca',     bank:'Bank Central Asia',     branch:'KCU Galaxy Surabaya',       account:'788 070 3662',       beneficiary:'PT Petroprima Sejahtera' },
      { id:'pps-maspion', bank:'Bank Maspion',            branch:'KC Basuki Rahmat Surabaya', account:'1012 029 663',       beneficiary:'PT Petroprima Sejahtera' },
      { id:'pps-permata', bank:'Bank Permata',            branch:'KC Tunjungan Surabaya',     account:'702 358 590',        beneficiary:'PT Petroprima Sejahtera' },
    ],
  },
};
