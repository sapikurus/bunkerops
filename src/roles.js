// Role definitions and permission matrix — single source of truth for the UI.
// (The hardened Firestore security rules mirror this same matrix.)

// Break-glass superadmin(s): these emails are ALWAYS treated as superadmin,
// regardless of what's in the bunkerops_users collection. This guarantees the
// owner can never be locked out by a missing/corrupt role doc or a bad edit.
// The UI also refuses to demote or delete these accounts.
export const HARDCODED_SUPERADMINS = [
  'info@petroprimasejahtera.net',
];

export function isHardcodedSuperadmin(email) {
  if (!email) return false;
  return HARDCODED_SUPERADMINS.map(e => e.toLowerCase()).includes(email.toLowerCase());
}

export const ROLES = {
  superadmin: { key: 'superadmin', label: 'Superadmin' },
  director:   { key: 'director',   label: 'Director' },
  supervisor: { key: 'supervisor', label: 'Supervisor' },
  operator:   { key: 'operator',   label: 'Operator' },
};

export const ROLE_ORDER = ['superadmin', 'director', 'supervisor', 'operator'];

// Permission levels per capability:
//   'edit'  = full create/edit/delete
//   'add'   = create + edit (but not manage master data)
//   'fill'  = fill an existing document (e.g. BAST) but not create/delete
//   'view'  = read only
//   false   = no access at all
export const PERMISSIONS = {
  superadmin: {
    masterData: 'edit', salesOrder: 'edit', deliveryOrder: 'edit',
    bast: 'edit', stockCards: 'edit', usersRoles: 'edit', generalSettings: 'edit',
  },
  director: {
    masterData: 'edit', salesOrder: 'edit', deliveryOrder: 'edit',
    bast: 'edit', stockCards: 'edit', usersRoles: 'edit', generalSettings: 'edit',
  },
  supervisor: {
    masterData: false, salesOrder: 'add', deliveryOrder: 'add',
    bast: 'fill', stockCards: 'view', usersRoles: false, generalSettings: false,
  },
  operator: {
    masterData: false, salesOrder: false, deliveryOrder: 'view',
    bast: 'fill', stockCards: 'view', usersRoles: false, generalSettings: false,
  },
};

// Does this role have at least 'view' access to a capability?
export function canAccess(role, capability) {
  const p = PERMISSIONS[role];
  return !!(p && p[capability]);
}

// Can this role create/edit (not just view) a capability?
export function canEdit(role, capability) {
  const p = PERMISSIONS[role];
  const lvl = p && p[capability];
  return lvl === 'edit' || lvl === 'add';
}

// Can this role delete / fully manage a capability?
export function canManage(role, capability) {
  const p = PERMISSIONS[role];
  return (p && p[capability]) === 'edit';
}

// Can this role fill an existing document (fill/add/edit all count)?
export function canFill(role, capability) {
  const p = PERMISSIONS[role];
  const lvl = p && p[capability];
  return lvl === 'edit' || lvl === 'add' || lvl === 'fill';
}
