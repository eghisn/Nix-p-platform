const STATE_KEY = "main";
const EMPTY_FINANCE_STATE = { general: [], sales: [], expenses: [], inventory: [], inventoryStock: [] };

export function isFinanceState(value) {
  return (
    value &&
    Array.isArray(value.general) &&
    Array.isArray(value.sales) &&
    Array.isArray(value.expenses) &&
    Array.isArray(value.inventory)
  );
}

export async function readFinanceState() {
  const remote = await readRemoteState().catch((error) => {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) throw error;
    return null;
  });
  if (isFinanceState(remote)) return normalizeFinanceState(remote);
  return normalizeFinanceState(EMPTY_FINANCE_STATE);
}

export async function writeFinanceState(state) {
  if (!isFinanceState(state)) throw new Error("Invalid finance state.");
  const normalized = normalizeFinanceState(state);
  await backupFinanceState(normalized);
  await supabaseFetch("finance_state?on_conflict=key", {
    method: "POST",
    body: [{ key: STATE_KEY, state: normalized }],
    prefer: "resolution=merge-duplicates,return=minimal"
  });
  return normalized;
}

async function backupFinanceState(nextState) {
  const previousState = await readRemoteState().catch(() => null);
  const id = `finance-state-${new Date().toISOString().replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
  return supabaseFetch("store_backups", {
    method: "POST",
    body: [{
      id,
      source: "finance-state",
      raw: {
        previous: isFinanceState(previousState) ? normalizeFinanceState(previousState) : null,
        next: nextState
      }
    }],
    prefer: "return=minimal"
  });
}

export function normalizeFinanceState(state) {
  return {
    general: Array.isArray(state.general) ? state.general : [],
    sales: Array.isArray(state.sales) ? state.sales : [],
    expenses: Array.isArray(state.expenses) ? state.expenses : [],
    inventory: Array.isArray(state.inventory) ? state.inventory : [],
    inventoryStock: Array.isArray(state.inventoryStock) ? state.inventoryStock : []
  };
}

async function readRemoteState() {
  const rows = await supabaseFetch(`finance_state?select=state&key=eq.${STATE_KEY}&limit=1`);
  return rows?.[0]?.state || null;
}

async function supabaseFetch(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: options.prefer || "return=representation"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Supabase finance state failed: ${response.status}`);
  return payload;
}
