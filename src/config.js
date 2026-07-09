// bunkerops configuration constants — encodes the approved schema decisions.
// Changing display name here renames the app everywhere (rename-cheap by design).

export const APP_NAME = 'bunkerops';

// Firestore collection prefix (sticky identifier — do not change casually).
export const PFX = 'bunkerops_';
export const COL = {
  nodes:         PFX + 'nodes',
  clients:       PFX + 'clients',
  salesRequests: PFX + 'salesRequests',
  deliveryOrders:PFX + 'deliveryOrders',
  bast:          PFX + 'bast',
  stockCards:    PFX + 'stockCards',
  users:         PFX + 'users',
  counters:      PFX + 'counters',   // atomic yearly sequence allocator
  healthcheck:   PFX + 'healthcheck',
};

// Our DO-issuing entities (Galley is client-side, never an issuer here).
export const ISSUERS = {
  PPS:     { key: 'PPS',     code: 'PPS',    name: 'PT. PETROPRIMA SEJAHTERA' },
  USI_PTS: { key: 'USI_PTS', code: 'USIPTS', name: 'PT. USI PETROTRANS SAMUDRA' },
};

// Ownership buckets in OB Galley (not commingled).
export const BUCKETS = ['PPS', 'MBSS'];

// Storage / delivery nodes. Node code appears in the DO number.
export const NODES = {
  OB_GALLEY: { id: 'ob_galley', code: 'OBG',  name: 'OB Galley',      type: 'floating_storage' },
  NORLHA_5:  { id: 'norlha_5',  code: 'NOR5', name: 'SPOB Norlha 5',  type: 'spob' },
  NORLHA_6:  { id: 'norlha_6',  code: 'NOR6', name: 'SPOB Norlha 6',  type: 'spob' },
};

// Schemes drive issuer + revenue treatment.
export const SCHEMES = {
  VHS:      { key: 'VHS',      label: 'VHS (fuel owned by MBSS, stored)', issuer: 'USI_PTS', bucket: 'MBSS' },
  PPS_SALE: { key: 'PPS_SALE', label: 'PPS Sale (fuel owned by PPS)',     issuer: 'PPS',     bucket: 'PPS'  },
};

// Storage-loss tolerance: 0.3% of incoming C, owner absorbs, USI PTS compensates excess.
export const TOLERANCE_PCT = 0.3;

// Roman-numeral month for document numbering.
export const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];

// Build a DO number: DO-{seq:0001}/{issuerCode}/{nodeCode}/{romanMonth}/{yy}
// seq is a single global yearly counter (resets 0001 on Jan 1), allocated atomically.
export function formatDoNumber({ seq, issuerCode, nodeCode, monthIndex, year }) {
  const s = String(seq).padStart(4, '0');
  return `DO-${s}/${issuerCode}/${nodeCode}/${ROMAN[monthIndex]}/${String(year).slice(-2)}`;
}

// Build a BAST number: {seq:02}/PTS-PPS/BAST/{romanMonth}/{yy}
export function formatBastNumber({ seq, monthIndex, year }) {
  const s = String(seq).padStart(2, '0');
  return `${s}/PTS-PPS/BAST/${ROMAN[monthIndex]}/${String(year).slice(-2)}`;
}
