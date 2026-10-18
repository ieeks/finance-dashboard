// Pure category helpers shared by scan, Gmail linking and the repair preview.
import { ALL_SUBCATEGORIES, normalizeSubcategory, SUBCAT_ITEM_RULES, BON_EXCLUDED_COMPANIES } from './categories.js?v=1.12.1';

// Use the same receipt scope for the dashboard and category repair.
const BON_BREAKDOWN_CATS = new Set([
  'Supermarkt', 'Restaurant / Café', 'Drogerie',
  'Online Shopping', 'Freizeit', 'Gesundheit',
]);

export function isBreakdownReceipt(bon, merchant = '', category = null) {
  if (!bon?.items?.length) return false;
  if (category && !BON_BREAKDOWN_CATS.has(category)) return false;
  const names = [merchant, bon.vendor, bon.store].filter(Boolean).map(name => String(name).toLowerCase());
  return !BON_EXCLUDED_COMPANIES.some(excluded => names.some(name => name.includes(excluded.toLowerCase())));
}

export function itemNameKey(name) {
  return String(name ?? '').normalize('NFKC').toLowerCase().trim()
    .replace(/^[\s@*]+/, '').replace(/\s+/g, ' ');
}

export function learnedCategory(name, overrides = {}) {
  const key = itemNameKey(name);
  if (!key) return null;
  // Conflicting old keys require an explicit new choice; never guess.
  const found = new Set(Object.entries(overrides)
    .filter(([k]) => itemNameKey(k) === key)
    .map(([, v]) => normalizeSubcategory(v))
    .filter(v => ALL_SUBCATEGORIES.includes(v)));
  return found.size === 1 ? [...found][0] : null;
}

export function withLearnedCategory(overrides, name, category) {
  const key = itemNameKey(name);
  const next = Object.fromEntries(Object.entries(overrides || {})
    .map(([k, v]) => [k, itemNameKey(k) === key ? category : v]));
  if (key) next[key] = category;
  return next;
}

export function resolveItemCategory(item, overrides = {}, suggest = false) {
  const raw = item.subcategory || item.subkategorie || 'Sonstiges';
  let category = normalizeSubcategory(raw);
  let source = item.subcategorySource || 'ai';
  if (source !== 'manual') {
    const learned = learnedCategory(item.name, overrides);
    if (learned) { category = learned; source = 'manual'; }
    else if (suggest && !Object.keys(overrides).some(key => itemNameKey(key) === itemNameKey(item.name))
        && (category === 'Sonstiges' || !ALL_SUBCATEGORIES.includes(category))) {
      const name = itemNameKey(item.name);
      const rule = SUBCAT_ITEM_RULES.find(([pattern]) => new RegExp(pattern).test(name));
      if (rule) { category = rule[1]; source = 'rule'; }
    }
  }
  const next = { ...item, subcategory: category,
    subcategoryRaw: item.subcategoryRaw ?? raw,
    subcategorySource: source,
    subcategoryNeedsReview: category === 'Sonstiges' || !ALL_SUBCATEGORIES.includes(category) };
  delete next.subkategorie;
  return next;
}

export function linkedBon(gmail, overrides = {}) {
  return { ...gmail.bon, invoiceId: gmail.id,
    items: (gmail.bon.items || []).map(item => resolveItemCategory(item, overrides)) };
}

// Order-independent comparison for stale-preview detection in Firestore.
export function bonSnapshot(value) {
  if (Array.isArray(value)) return '[' + value.map(bonSnapshot).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + bonSnapshot(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

export function planCategoryRepair(transactions, pendingBons, overrides = {}) {
  const changes = [];
  const rows = [];
  const inputs = [
    ...transactions.map(tx => ({ collection: 'transactions', id: tx.id, bon: tx.bon,
      merchant: tx.description, category: tx.category, date: tx.date })),
    ...pendingBons.map(bon => ({ collection: 'pendingBons', id: bon.id, bon,
      merchant: bon.store || bon.vendor, category: bon.category, date: bon.date })),
  ];
  for (const input of inputs) {
    if (!isBreakdownReceipt(input.bon, input.merchant, input.category)) continue;
    const changedRows = [];
    const items = input.bon.items.map((item, index) => {
      const old = item.subcategory || item.subkategorie || 'Sonstiges';
      // Keep deliberately chosen categories, including manual Sonstiges.
      if (item.subcategorySource === 'manual') return item;
      const next = resolveItemCategory(item, overrides, true);
      if (next.subcategory === old || !ALL_SUBCATEGORIES.includes(next.subcategory)
          || next.subcategory === 'Sonstiges') return item;
      changedRows.push({ name: item.name, from: old, to: next.subcategory,
        merchant: input.merchant || '', date: input.date || '',
        // Linked and original copies appear once in the preview.
        key: `${input.bon.invoiceId || input.id}:${index}` });
      return next;
    });
    if (changedRows.length) {
      changes.push({ collection: input.collection, id: input.id,
        before: structuredClone(input.bon), after: { ...input.bon, items } });
      rows.push(...changedRows);
    }
  }
  return { changes, rows: [...new Map(rows.map(row => [row.key, row])).values()] };
}
