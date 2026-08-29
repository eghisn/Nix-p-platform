const state = { dashboard: null, view: "overview" };
const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("id-ID", { style: "percent", maximumFractionDigits: 2 });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function boot() {
  try {
    const session = await request("/api/auth/session");
    if (session.authenticated && session.workspace === "marketing") return showDashboard();
  } catch {}
  showLogin();
}

function showLogin() {
  document.querySelector("[data-login-gate]").hidden = false;
  document.querySelector("[data-dashboard]").hidden = true;
}

async function showDashboard() {
  document.querySelector("[data-login-gate]").hidden = true;
  document.querySelector("[data-dashboard]").hidden = false;
  await loadDashboard();
}

async function loadDashboard() {
  const days = Number(document.querySelector("[data-period]").value || 30);
  document.querySelector("[data-status-copy]").textContent = "Refreshing live website events, commerce records, and contacts.";
  try {
    const payload = await request(`/api/marketing?days=${days}`);
    state.dashboard = payload.dashboard;
    renderDashboard(payload.dashboard);
  } catch (error) {
    if (error.status === 401) return showLogin();
    document.querySelector("[data-status-copy]").textContent = error.message;
  }
}

function renderDashboard(data) {
  const metrics = data.metrics;
  setText('[data-metric="sales"]', money.format(metrics.netSales));
  setText('[data-metric="orders"]', integer.format(metrics.paidOrders));
  setText('[data-metric="visitors"]', integer.format(metrics.visitors));
  setText('[data-metric="conversion"]', percent.format(metrics.conversion));
  document.querySelector("[data-updated]").textContent = `Updated ${formatDateTime(data.generatedAt)} / ${data.rangeDays} days`;
  document.querySelector("[data-status-copy]").textContent = `${integer.format(data.health.eventRows)} consented events and ${integer.format(data.health.orderRows)} commerce records loaded.`;
  renderChart(data.daily);
  renderProducts(data.products);
  renderAudience(data);
  renderInsights(data);
  renderFunnel(data);
  renderCampaigns();
  renderContacts();
  renderData(data);
  renderConsent();
}

function renderInsights(data) {
  const topDevice = data.devices[0];
  const topSource = data.sources[0];
  const rows = [
    ["Product attention", `${integer.format(data.metrics.productViews)} product views from ${integer.format(data.metrics.sessions)} measured sessions.`],
    [topDevice ? `${topDevice.name} leads devices` : "Device mix pending", topDevice ? `${percent.format(topDevice.share)} of consented events use this device type.` : "Device data appears after visitors accept analytics."],
    [topSource ? `${sourceName(topSource)} leads acquisition` : "Acquisition pending", topSource ? `${integer.format(topSource.sessions)} attributed sessions in this reporting period.` : "Source data appears after attributed visits."],
    ["Cart abandonment estimate", data.metrics.addToCart ? `${percent.format(data.metrics.cartAbandonment)} of measured cart sessions did not reach checkout start.` : "No add-to-cart events in this period."]
  ];
  document.querySelector("[data-insight-list]").innerHTML = rows.map(([title, copy]) => `<li><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></li>`).join("");
}

function renderProducts(rows) {
  document.querySelector("[data-products-table]").innerHTML = rows.slice(0, 12).map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.artist || "-")}</td><td>${integer.format(item.views)}</td><td>${integer.format(item.added)}</td><td>${integer.format(item.orders)}</td><td class="number">${money.format(item.sales)}</td></tr>`).join("") || emptyRow(6, "No product activity in this period.");
}

function renderChart(rows) {
  const values = rows.slice(-12);
  const salesMax = Math.max(1, ...values.map((row) => row.sales));
  const visitorMax = Math.max(1, ...values.map((row) => row.visitors));
  document.querySelector("[data-chart-bars]").innerHTML = values.map((row) => `<div class="bar-group" title="${escapeHtml(row.date)}: ${money.format(row.sales)}, ${integer.format(row.visitors)} visitors"><i class="bar sales" style="height:${Math.max(3, row.sales / salesMax * 100)}%"></i><i class="bar visitors" style="height:${Math.max(3, row.visitors / visitorMax * 100)}%"></i></div>`).join("") || `<p class="empty-inline">No daily activity</p>`;
  document.querySelector("[data-chart-labels]").innerHTML = values.map((row) => `<span>${escapeHtml(row.date.slice(5))}</span>`).join("");
}

function renderAudience(data) {
  const panels = document.querySelectorAll('[data-view-panel="audience"] .metric-panel strong');
  [data.metrics.visitors, data.metrics.sessions, data.metrics.productViews].forEach((value, index) => { if (panels[index]) panels[index].textContent = integer.format(value); });
  renderRanks("[data-geography-list]", data.countries);
  renderRanks("[data-device-list]", data.devices);
  document.querySelector("[data-source-table]").innerHTML = data.sources.map((item) => `<tr><td><strong>${escapeHtml(sourceName(item))}</strong></td><td>${integer.format(item.sessions)}</td><td>${integer.format(item.views)}</td><td>-</td><td class="number">-</td></tr>`).join("") || emptyRow(5, "No attributed visits in this period.");
}

function renderRanks(selector, rows) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  document.querySelector(selector).innerHTML = rows.slice(0, 10).map((row) => `<div class="rank-row"><span>${escapeHtml(row.name)}</span><div class="rank-bar"><i style="width:${row.count / max * 100}%"></i></div><strong>${percent.format(row.share)}</strong></div>`).join("") || `<p class="panel-copy">No data in this period.</p>`;
}

function renderFunnel(data) {
  const max = Math.max(1, data.funnel[0]?.value || 0);
  document.querySelector("[data-funnel-list]").innerHTML = data.funnel.map((step) => `<div class="funnel-step"><span>${escapeHtml(step.label)}</span><div class="funnel-track"><i style="width:${Math.max(step.value ? 2 : 0, step.value / max * 100)}%"></i></div><strong>${integer.format(step.value)}</strong></div>`).join("");
  setText("[data-funnel-conversion]", percent.format(data.metrics.conversion));
  const outcomeValues = [data.orderOutcomes.paid, data.orderOutcomes.expired, data.orderOutcomes.cancelled, data.orderOutcomes.refunded];
  document.querySelectorAll(".outcome-grid strong").forEach((node, index) => { node.textContent = integer.format(outcomeValues[index] || 0); });
}

function renderCampaigns(query = "") {
  const rows = state.dashboard?.sources || [];
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter((item) => sourceName(item).toLowerCase().includes(needle));
  document.querySelector("[data-campaign-table]").innerHTML = filtered.map((item) => `<tr><td><strong>${escapeHtml(sourceName(item))}</strong></td><td>${integer.format(item.sessions)}</td><td>${integer.format(item.views)}</td><td>${integer.format(item.added)}</td><td>-</td><td class="number">-</td></tr>`).join("") || emptyRow(6, "No campaign source matches this search.");
}

function renderContacts(query = "") {
  const data = state.dashboard;
  if (!data) return;
  setText('[data-contact-metric="known"]', integer.format(data.metrics.knownCustomers));
  setText('[data-contact-metric="consent"]', "0");
  setText('[data-contact-metric="returning"]', integer.format(data.metrics.returningCustomers));
  const needle = query.trim().toLowerCase();
  const rows = data.contacts.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(needle));
  document.querySelector("[data-contacts-table]").innerHTML = rows.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong><br><span>${escapeHtml(item.email)}</span></td><td>Order</td><td>${formatDate(item.lastOrder)}</td><td>${integer.format(item.orders)}</td><td><span class="consent-badge">Not collected</span></td><td class="number">${money.format(item.sales)}</td></tr>`).join("") || emptyRow(6, "No customer contact matches this search.");
}

function renderData(data) {
  document.querySelector("[data-events-table]").innerHTML = data.events.map((item) => `<tr><td>${formatDateTime(item.time)}</td><td><strong>${escapeHtml(item.event)}</strong></td><td>${escapeHtml(item.path)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.session)}</td></tr>`).join("") || emptyRow(5, "No consented events in this period.");
  document.querySelector("[data-daily-metrics-table]").innerHTML = data.daily.slice().reverse().map((item) => `<tr><td><strong>${escapeHtml(item.date)}</strong></td><td>${integer.format(item.visitors)}</td><td>${integer.format(item.productViews)}</td><td>${integer.format(item.added)}</td><td>${integer.format(item.orders)}</td><td class="number">${money.format(item.sales)}</td></tr>`).join("") || emptyRow(6, "No daily metrics in this period.");
  const cards = document.querySelectorAll(".data-model-card dd");
  const values = [data.health.eventRows, "Live", data.daily.at(-1)?.date || "-", "On request", data.sources.length, "5 fields", data.metrics.knownCustomers, "0 opted in"];
  cards.forEach((node, index) => { if (values[index] !== undefined) node.textContent = values[index]; });
  const checks = document.querySelectorAll(".health-list span");
  const checkValues = ["Event ID enforced", formatFreshness(data.health.newestEvent), data.health.orderRows ? "Commerce ledger connected" : "No orders in range", "Required before ingest"];
  checks.forEach((node, index) => { node.textContent = checkValues[index] || "-"; });
}

function renderConsent() {
  document.querySelectorAll("[data-consent-toggle]").forEach((button) => { button.disabled = true; button.textContent = "Managed on public site"; });
  document.querySelector("[data-consent-log]").innerHTML = `<p><strong>Analytics events</strong><span>Only after visitor acceptance</span></p><p><strong>Essential operations</strong><span>Always available</span></p><p><strong>Marketing email</strong><span>Not collected yet</span></p>`;
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { const active = panel.dataset.viewPanel === view; panel.hidden = !active; panel.classList.toggle("is-active", active); });
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
}

function exportCsv() {
  const products = state.dashboard?.products || [];
  const rows = [["Product", "Artist", "Views", "Added to cart", "Paid orders", "Net sales"], ...products.map((item) => [item.title, item.artist, item.views, item.added, item.orders, item.sales])];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `nixp-marketing-${new Date().toISOString().slice(0, 10)}.csv` });
  link.click();
  URL.revokeObjectURL(url);
}

document.querySelector("[data-login-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("[data-login-message]");
  const button = form.querySelector("button");
  button.disabled = true;
  message.textContent = "Signing in...";
  try {
    await request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace: "marketing", username: form.username.value.trim(), password: form.password.value }) });
    form.reset();
    message.textContent = "";
    await showDashboard();
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
document.querySelectorAll("[data-view-link]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); switchView(link.dataset.viewLink); }));
document.querySelector("[data-export]").addEventListener("click", exportCsv);
document.querySelector("[data-refresh]").addEventListener("click", loadDashboard);
document.querySelector("[data-logout]").addEventListener("click", async () => { await request("/api/auth/logout", { method: "POST" }).catch(() => {}); showLogin(); });
document.querySelector("[data-period]").addEventListener("change", loadDashboard);
document.querySelector("[data-campaign-search]").addEventListener("input", (event) => renderCampaigns(event.target.value));
document.querySelector("[data-contact-search]").addEventListener("input", (event) => renderContacts(event.target.value));

function setText(selector, value) { const node = document.querySelector(selector); if (node) node.textContent = value; }
function sourceName(item) { return item.campaign ? `${item.source} / ${item.campaign}` : item.source; }
function emptyRow(columns, text) { return `<tr><td colspan="${columns}">${escapeHtml(text)}</td></tr>`; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(value)) : "No order"; }
function formatDateTime(value) { return value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "No data"; }
function formatFreshness(value) { if (!value) return "No events yet"; const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000)); return minutes < 2 ? "Current" : `${minutes} min ago`; }

boot();
