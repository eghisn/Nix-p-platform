const state = { dashboard: null, view: "overview", sorts: {}, reportGrain: "weekly", contentPlanSort: "plannedAt", editingContentPlanId: "" };
const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("id-ID", { style: "percent", maximumFractionDigits: 2 });
const sortDefaults = {
  products: { key: "sales", direction: "desc" },
  "monthly-campaigns": { key: "sales", direction: "desc" },
  "monthly-products": { key: "sales", direction: "desc" },
  opportunities: { key: "priority", direction: "asc" },
  "catalog-products": { key: "sales", direction: "desc" },
  "instagram-posts": { key: "timestamp", direction: "desc" },
  "time-series": { key: "label", direction: "desc" },
  sources: { key: "sessions", direction: "desc" },
  campaigns: { key: "sales", direction: "desc" },
  contacts: { key: "lastOrder", direction: "desc" },
  events: { key: "time", direction: "desc" },
  daily: { key: "date", direction: "desc" }
};

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
  const month = document.querySelector("[data-monthly-month]")?.value || "";
  document.querySelector("[data-status-copy]").textContent = "Refreshing live website events, commerce records, and contacts.";
  try {
    const payload = await request(`/api/marketing?days=${days}${month ? `&month=${encodeURIComponent(month)}` : ""}`);
    state.dashboard = payload.dashboard;
    renderDashboard(payload.dashboard);
  } catch (error) {
    if (error.status === 401) return showLogin();
    document.querySelector("[data-status-copy]").textContent = error.message;
  }
}

function renderDashboard(data) {
  const metrics = data.metrics;
  setText('[data-metric="sales"]', money.format(metrics.cashNetSales));
  setText('[data-metric="orders"]', integer.format(metrics.paidOrders));
  setText('[data-metric="visitors"]', integer.format(metrics.visitors));
  setText('[data-metric="conversion"]', percent.format(metrics.checkoutCreatedRate));
  document.querySelector("[data-updated]").textContent = `Updated ${formatDateTime(data.generatedAt)} / ${data.rangeDays} days`;
  document.querySelector("[data-status-copy]").textContent = `${integer.format(data.health.eventRows)} consented events and ${integer.format(data.health.orderRows)} commerce records loaded.`;
  renderChart(data.daily);
  renderProducts(data.products);
  renderOpportunities(data.products);
  renderCatalogProducts(data.products);
  renderCheckout(data);
  renderInstagram(data);
  renderContentPlans(data.contentPlans || []);
  renderTimeSeries(data.daily);
  renderAudience(data);
  renderInsights(data);
  renderMonthly(data.monthly || {});
  renderFunnel(data);
  renderCampaigns();
  renderContacts();
  renderData(data);
  renderConsent();
  updateSortIndicators();
}

function renderAccountingBasis() {
  const heading = [...document.querySelectorAll(".panel h3")].find((node) => node.textContent === "Net sales basis");
  if (!heading) return;
  heading.textContent = "Cash sales basis";
  heading.closest(".panel")?.querySelector(".panel-copy")?.replaceChildren(
    "Cash net sales are provider-verified payments minus verified refunds on the day each cash movement is confirmed. Product tables show gross item sales because refunds are not allocated by item yet. Shipping remains separate."
  );
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
  const sorted = sortRows("products", rows, (item, key) => item[key]);
  document.querySelector("[data-products-table]").innerHTML = sorted.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.artist || "-")}</td><td>${integer.format(item.productViews)}</td><td>${integer.format(item.productClicks)}</td><td>${integer.format(item.added)}</td><td>${integer.format(item.orders)}</td><td class="number">${money.format(item.sales)}</td></tr>`).join("") || emptyRow(7, "No product activity in this period.");
}

function renderCatalogProducts(rows) {
  const sorted = sortRows("catalog-products", rows, (item, key) => item[key]);
  const target = document.querySelector("[data-catalog-products-table]");
  if (!target) return;
  target.innerHTML = sorted.map((item) => productTableRow(item)).join("") || emptyRow(7, "No product activity in this period.");
}

function renderOpportunities(rows) {
  const opportunities = rows.map(productOpportunity);
  const sorted = sortRows("opportunities", opportunities, (item, key) => item[key]);
  const target = document.querySelector("[data-opportunities-table]");
  if (!target) return;
  target.innerHTML = sorted.map((item) => `<tr><td><strong class="priority priority-${item.priority}">${escapeHtml(item.priorityLabel)}</strong></td><td><strong>${escapeHtml(item.title)}</strong><br><span>${escapeHtml(item.artist || "-")}</span></td><td>${escapeHtml(item.signal)}</td><td>${integer.format(item.productViews)}</td><td>${integer.format(item.added)}</td><td>${integer.format(item.orders)}</td><td class="number">${money.format(item.sales)}</td></tr>`).join("") || emptyRow(7, "No product signals in this period.");
}

function productTableRow(item) {
  return `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.artist || "-")}</td><td>${integer.format(item.productViews)}</td><td>${integer.format(item.productClicks)}</td><td>${integer.format(item.added)}</td><td>${integer.format(item.orders)}</td><td class="number">${money.format(item.sales)}</td></tr>`;
}

function productOpportunity(item) {
  const views = Number(item.productViews || 0);
  const added = Number(item.added || 0);
  const orders = Number(item.orders || 0);
  if (added > 0 && orders === 0) return { ...item, priority: 1, priorityLabel: "Check now", signal: "Cart interest, no paid order" };
  if (views >= 3 && added === 0) return { ...item, priority: 2, priorityLabel: "Improve", signal: "Interest without a cart" };
  if (orders > 0) return { ...item, priority: 3, priorityLabel: "Working", signal: "Already converting" };
  return { ...item, priority: 4, priorityLabel: "Watch", signal: views ? "Early product attention" : "No measured signal" };
}

function renderCheckout(data) {
  const outcomes = data.orderOutcomes || {};
  setText('[data-checkout-metric="abandonment"]', percent.format(data.metrics.cartAbandonment || 0));
  setText('[data-checkout-metric="paid"]', integer.format(outcomes.paid || 0));
  setText('[data-checkout-metric="expired"]', integer.format(outcomes.expired || 0));
  setText('[data-checkout-metric="refunded"]', integer.format(outcomes.refunded || 0));

  const funnel = document.querySelector("[data-checkout-funnel]");
  const steps = Array.isArray(data.funnel) ? data.funnel : [];
  const max = Math.max(1, steps[0]?.value || 0);
  if (funnel) {
    funnel.innerHTML = steps.map((step) => `<div class="funnel-step"><span>${escapeHtml(step.label)}</span><div class="funnel-track"><i data-bar-width="${Math.max(step.value ? 2 : 0, Number(step.value || 0) / max * 100)}"></i></div><strong>${integer.format(step.value || 0)}</strong></div>`).join("") || `<p class="panel-copy">No measured checkout activity in this period.</p>`;
    applyDynamicBarSizes(funnel);
  }

  const messages = [];
  if (Number(outcomes.expired || 0)) messages.push(["Payment expiry", `${integer.format(outcomes.expired)} payment window${Number(outcomes.expired) === 1 ? "" : "s"} expired. Check whether the payment window and customer follow-up are appropriate.`]);
  if (Number(data.metrics.addToCart || 0)) messages.push(["Cart to checkout", `${percent.format(data.metrics.cartAbandonment || 0)} of measured cart sessions did not begin checkout.`]);
  if (Number(outcomes.refunded || 0)) messages.push(["Refunds", `${integer.format(outcomes.refunded)} verified refund${Number(outcomes.refunded) === 1 ? "" : "s"} in this period.`]);
  if (!messages.length) messages.push(["No operational warning", "No expired payments, refunds, or measured cart activity in this period."]);
  const target = document.querySelector("[data-checkout-insights]");
  if (target) target.innerHTML = messages.map(([title, copy]) => `<li><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></li>`).join("");
}

function renderInstagram(data) {
  const sources = (data.sources || []).filter((item) => String(item.source || "").toLowerCase() === "instagram");
  const totals = sources.reduce((sum, item) => ({
    sessions: sum.sessions + Number(item.sessions || 0),
    productViews: sum.productViews + Number(item.productViews || 0),
    paidOrders: sum.paidOrders + Number(item.paidOrders || 0),
    sales: sum.sales + Number(item.sales || 0)
  }), { sessions: 0, productViews: 0, paidOrders: 0, sales: 0 });
  setText('[data-instagram-metric="sessions"]', integer.format(totals.sessions));
  setText('[data-instagram-metric="views"]', integer.format(totals.productViews));
  setText('[data-instagram-metric="orders"]', integer.format(totals.paidOrders));
  setText('[data-instagram-metric="sales"]', money.format(totals.sales));

  const instagram = data.instagram || {};
  const status = document.querySelector("[data-instagram-status]");
  if (status) {
    const connected = instagram.status === "connected";
    status.textContent = connected ? "Connected" : instagram.status === "unavailable" ? "Unavailable" : "Setup required";
    status.classList.toggle("is-on", connected);
  }
  setText("[data-instagram-copy]", instagram.message || "Instagram post metrics are not configured. Website attribution remains available.");

  const campaignTarget = document.querySelector("[data-instagram-campaign-list]");
  if (campaignTarget) {
    const ranked = [...sources].sort((left, right) => Number(right.sales || 0) - Number(left.sales || 0));
    campaignTarget.innerHTML = ranked.map((item) => `<div class="rank-row"><span>${escapeHtml(item.campaign || "Untagged Instagram link")}</span><div class="rank-bar"><i data-bar-width="${Math.max(2, totals.sessions ? Number(item.sessions || 0) / totals.sessions * 100 : 0)}"></i></div><strong>${money.format(item.sales || 0)}</strong></div>`).join("") || `<p class="panel-copy">No Instagram-attributed website visits in this period. Add UTM tags to links in bio, stories, and post links.</p>`;
    applyDynamicBarSizes(campaignTarget);
  }

  const posts = sortRows("instagram-posts", instagram.posts || [], (item, key) => item[key]);
  const postTarget = document.querySelector("[data-instagram-posts-table]");
  if (postTarget) postTarget.innerHTML = posts.map((item) => `<tr><td>${formatDate(item.timestamp)}</td><td><strong>${escapeHtml(item.caption)}</strong></td><td>${escapeHtml(item.mediaType)}</td><td>${integer.format(item.likes)}</td><td>${integer.format(item.comments)}</td><td><a class="outbound-link" href="${escapeHtml(item.permalink)}" target="_blank" rel="noreferrer">View</a></td></tr>`).join("") || emptyRow(6, instagram.status === "setup_required" ? "Connect Meta to see post engagement. Website attribution is already measured through UTM links." : "No Instagram posts returned for this account.");
}

function renderContentPlans(plans) {
  const target = document.querySelector("[data-content-plan-list]");
  if (!target) return;
  const sort = document.querySelector("[data-content-plan-sort]")?.value || state.contentPlanSort;
  state.contentPlanSort = sort;
  const sorted = [...plans].sort((left, right) => {
    if (sort === "progress") return Number(right.progress ?? -1) - Number(left.progress ?? -1);
    if (sort === "revenue") return Number(right.actual?.revenue || 0) - Number(left.actual?.revenue || 0);
    if (sort === "sessions") return Number(right.actual?.sessions || 0) - Number(left.actual?.sessions || 0);
    return String(right.plannedAt || "").localeCompare(String(left.plannedAt || "")) || String(right.title).localeCompare(String(left.title));
  });
  target.innerHTML = sorted.map((plan) => contentPlanCard(plan)).join("") || `<p class="content-plan-empty">Add a content plan to compare its targets with Instagram and website results.</p>`;
}

function contentPlanCard(plan) {
  const target = plan.target || {};
  const actual = plan.actual || {};
  const progress = plan.progress === null || plan.progress === undefined ? "No targets" : percent.format(plan.progress);
  const postStatus = plan.instagramPermalink ? (plan.instagramPostFound ? "Post linked" : "Post metrics pending") : "Add post URL";
  return `
    <article class="content-plan-card">
      <header class="content-plan-card-heading">
        <div><span>${escapeHtml(plan.contentType)}</span><h4>${escapeHtml(plan.title)}</h4><p>${escapeHtml(plan.objective)}${plan.plannedAt ? ` / ${escapeHtml(formatDate(plan.plannedAt))}` : ""}</p></div>
        <div class="content-plan-status"><strong class="content-result content-result-${escapeHtml(String(plan.result || "tracking").toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(plan.result || "Tracking")}</strong><span>${progress}</span></div>
      </header>
      <div class="content-plan-metrics">
        ${contentPlanMetric("Reach", target.reach, actual.reach, integer)}
        ${contentPlanMetric("Saves + shares", target.savesShares, actual.savesShares, integer)}
        ${contentPlanMetric("Profile visits", target.profileVisits, actual.profileVisits, integer)}
        ${contentPlanMetric("New followers", target.newFollowers, actual.newFollowers, integer)}
        ${contentPlanMetric("Likes", target.likes, actual.likes, integer)}
        ${contentPlanMetric("Comments", target.comments, actual.comments, integer)}
        ${contentPlanMetric("Website visits", target.sessions, actual.sessions, integer)}
        ${contentPlanMetric("Carts", target.carts, actual.carts, integer)}
        ${contentPlanMetric("Paid orders", target.paidOrders, actual.paidOrders, integer)}
        ${contentPlanMetric("Revenue", target.revenue, actual.revenue, money)}
      </div>
      <footer class="content-plan-card-foot">
        <div class="content-plan-tracking"><span>${escapeHtml(postStatus)}</span><code>${escapeHtml(plan.trackingContent)}</code></div>
        <div class="content-plan-card-actions"><button class="button button-compact" type="button" data-content-plan-copy="${escapeHtml(plan.trackingUrl)}">Copy link</button><button class="button button-compact" type="button" data-content-plan-edit="${escapeHtml(plan.id)}">Edit</button><button class="button button-compact button-danger" type="button" data-content-plan-delete="${escapeHtml(plan.id)}">Delete</button></div>
      </footer>
    </article>`;
}

function contentPlanMetric(label, target, actual, formatter) {
  const planned = Number(target || 0);
  const hasActual = actual !== null && actual !== undefined && actual !== "" && Number.isFinite(Number(actual));
  const result = hasActual ? Number(actual) : 0;
  const progress = planned && hasActual ? Math.min(100, Math.round(result / planned * 100)) : null;
  const outcome = hasActual ? formatter.format(result) : "--";
  const detail = !planned ? "No target" : !hasActual ? `${formatter.format(planned)} target / Waiting for data` : `${formatter.format(planned)} target / ${progress}%`;
  return `<div class="content-plan-metric"><span>${escapeHtml(label)}</span><strong>${outcome}</strong><small>${detail}</small></div>`;
}

function contentTrackingId(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function contentPlanPayload(form) {
  const value = (name) => String(form.elements[name]?.value || "").trim();
  return {
    title: value("title"), contentType: value("contentType"), objective: value("objective"), status: value("status"),
    plannedAt: value("plannedAt"), campaign: value("campaign"), trackingContent: value("trackingContent"),
    destinationPath: value("destinationPath"), instagramPermalink: value("instagramPermalink"), targetReach: value("targetReach"),
    targetSavesShares: value("targetSavesShares"), targetProfileVisits: value("targetProfileVisits"), targetNewFollowers: value("targetNewFollowers"), targetLikes: value("targetLikes"),
    targetComments: value("targetComments"), targetSessions: value("targetSessions"), targetCarts: value("targetCarts"),
    targetPaidOrders: value("targetPaidOrders"), targetRevenue: value("targetRevenue")
  };
}

function updateContentPlanLinkPreview(form) {
  if (!form) return;
  const preview = document.querySelector("[data-content-plan-link-preview]");
  const value = document.querySelector("[data-content-plan-link-value]");
  if (!preview || !value) return;
  const payload = contentPlanPayload(form);
  const content = contentTrackingId(payload.trackingContent || payload.title);
  if (!content) return preview.hidden = true;
  try {
    const url = new URL(payload.destinationPath?.startsWith("/") ? payload.destinationPath : "/", "https://www.nix-p.com");
    url.searchParams.set("utm_source", "instagram");
    url.searchParams.set("utm_medium", "social");
    url.searchParams.set("utm_campaign", contentTrackingId(payload.campaign) || content);
    url.searchParams.set("utm_content", content);
    value.textContent = url.toString();
    preview.hidden = false;
  } catch {
    preview.hidden = true;
  }
}

function resetContentPlanForm() {
  const form = document.querySelector("[data-content-plan-form]");
  if (!form) return;
  form.reset();
  form.elements.destinationPath.value = "/";
  delete form.elements.trackingContent.dataset.manual;
  state.editingContentPlanId = "";
  setText("[data-content-plan-form-title]", "New content");
  document.querySelector("[data-content-plan-cancel]")?.setAttribute("hidden", "");
  setText("[data-content-plan-message]", "");
  updateContentPlanLinkPreview(form);
}

function editContentPlan(id) {
  const plan = (state.dashboard?.contentPlans || []).find((item) => item.id === id);
  const form = document.querySelector("[data-content-plan-form]");
  if (!plan || !form) return;
  state.editingContentPlanId = plan.id;
  const values = {
    title: plan.title, contentType: plan.contentType, objective: plan.objective, status: plan.status, plannedAt: plan.plannedAt || "",
    campaign: plan.campaign === plan.trackingContent ? "" : plan.campaign, trackingContent: plan.trackingContent, destinationPath: plan.destinationPath,
    instagramPermalink: plan.instagramPermalink, targetReach: plan.target.reach, targetSavesShares: plan.target.savesShares,
    targetProfileVisits: plan.target.profileVisits, targetNewFollowers: plan.target.newFollowers, targetLikes: plan.target.likes, targetComments: plan.target.comments, targetSessions: plan.target.sessions,
    targetCarts: plan.target.carts, targetPaidOrders: plan.target.paidOrders, targetRevenue: plan.target.revenue
  };
  Object.entries(values).forEach(([name, value]) => { if (form.elements[name]) form.elements[name].value = value; });
  form.elements.trackingContent.dataset.manual = "true";
  setText("[data-content-plan-form-title]", `Edit: ${plan.title}`);
  document.querySelector("[data-content-plan-cancel]")?.removeAttribute("hidden");
  updateContentPlanLinkPreview(form);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderTimeSeries(rows) {
  const grain = document.querySelector("[data-report-grain]")?.value || state.reportGrain;
  state.reportGrain = grain;
  const periods = rollupTimeSeries(rows || [], grain);
  const sorted = sortRows("time-series", periods, (item, key) => item[key]);
  const target = document.querySelector("[data-time-series-table]");
  if (!target) return;
  target.innerHTML = sorted.map((item) => `<tr><td><strong>${escapeHtml(item.label)}</strong></td><td>${integer.format(item.visitors)}</td><td>${integer.format(item.productViews)}</td><td>${integer.format(item.added)}</td><td>${integer.format(item.checkouts)}</td><td>${integer.format(item.orders)}</td><td class="number">${money.format(item.cashNetSales)}</td></tr>`).join("") || emptyRow(7, "No activity in this reporting period.");
}

function rollupTimeSeries(rows, grain) {
  const grouped = new Map();
  rows.forEach((row) => {
    const label = timeSeriesLabel(row.date, grain);
    const previous = grouped.get(label) || { label, visitors: 0, productViews: 0, added: 0, checkouts: 0, orders: 0, cashNetSales: 0 };
    previous.visitors += Number(row.visitors || 0);
    previous.productViews += Number(row.productViews || 0);
    previous.added += Number(row.added || 0);
    previous.checkouts += Number(row.checkouts || 0);
    previous.orders += Number(row.orders || 0);
    previous.cashNetSales += Number(row.cashNetSales || 0);
    grouped.set(label, previous);
  });
  return [...grouped.values()];
}

function timeSeriesLabel(date, grain) {
  if (grain === "daily") return String(date || "");
  if (grain === "monthly") return String(date || "").slice(0, 7);
  const value = new Date(`${String(date || "").slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return String(date || "");
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return `Week of ${value.toISOString().slice(0, 10)}`;
}

function renderChart(rows) {
  const values = rows.slice(-12);
  const salesMax = Math.max(1, ...values.map((row) => row.cashNetSales));
  const visitorMax = Math.max(1, ...values.map((row) => row.visitors));
  const chart = document.querySelector("[data-chart-bars]");
  chart.innerHTML = values.map((row) => `<div class="bar-group" title="${escapeHtml(row.date)}: ${money.format(row.cashNetSales)} cash net sales, ${integer.format(row.visitors)} visitors"><i class="bar sales" data-bar-height="${Math.max(3, row.cashNetSales / salesMax * 100)}"></i><i class="bar visitors" data-bar-height="${Math.max(3, row.visitors / visitorMax * 100)}"></i></div>`).join("") || `<p class="empty-inline">No daily activity</p>`;
  applyDynamicBarSizes(chart);
  document.querySelector("[data-chart-labels]").innerHTML = values.map((row) => `<span>${escapeHtml(row.date.slice(5))}</span>`).join("");
}

function renderAudience(data) {
  const panels = document.querySelectorAll('[data-view-panel="audience"] .metric-panel strong');
  [data.metrics.visitors, data.metrics.sessions, data.metrics.productViews].forEach((value, index) => { if (panels[index]) panels[index].textContent = integer.format(value); });
  renderRanks("[data-geography-list]", data.countries);
  renderRanks("[data-device-list]", data.devices);
  const sources = sortRows("sources", data.sources, (item, key) => key === "source" ? sourceName(item) : item[key]);
  document.querySelector("[data-source-table]").innerHTML = sources.map((item) => `<tr><td><strong>${escapeHtml(sourceName(item))}</strong></td><td>${integer.format(item.sessions)}</td><td>${integer.format(item.productViews)}</td><td>${integer.format(item.paidOrders)}</td><td class="number">${money.format(item.sales)}</td></tr>`).join("") || emptyRow(5, "No attributed visits in this period.");
}

function renderRanks(selector, rows) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const root = document.querySelector(selector);
  root.innerHTML = rows.slice(0, 10).map((row) => `<div class="rank-row"><span>${escapeHtml(row.name)}</span><div class="rank-bar"><i data-bar-width="${row.count / max * 100}"></i></div><strong>${percent.format(row.share)}</strong></div>`).join("") || `<p class="panel-copy">No data in this period.</p>`;
  applyDynamicBarSizes(root);
}

function renderFunnel(data) {
  const max = Math.max(1, data.funnel[0]?.value || 0);
  const funnel = document.querySelector("[data-funnel-list]");
  funnel.innerHTML = data.funnel.map((step) => `<div class="funnel-step"><span>${escapeHtml(step.label)}</span><div class="funnel-track"><i data-bar-width="${Math.max(step.value ? 2 : 0, step.value / max * 100)}"></i></div><strong>${integer.format(step.value)}</strong></div>`).join("");
  applyDynamicBarSizes(funnel);
  setText("[data-funnel-conversion]", percent.format(data.metrics.checkoutCreatedRate));
  const outcomeValues = [data.orderOutcomes.paid, data.orderOutcomes.expired, data.orderOutcomes.cancelled, data.orderOutcomes.refunded];
  document.querySelectorAll('[data-view-panel="funnel"] .outcome-grid strong').forEach((node, index) => { node.textContent = integer.format(outcomeValues[index] || 0); });
}

function renderCampaigns(query = "") {
  const rows = state.dashboard?.sources || [];
  const needle = query.trim().toLowerCase();
  const filtered = sortRows("campaigns", rows.filter((item) => sourceName(item).toLowerCase().includes(needle)), (item, key) => key === "source" ? sourceName(item) : item[key]);
  document.querySelector("[data-campaign-table]").innerHTML = filtered.map((item) => `<tr><td><strong>${escapeHtml(sourceName(item))}</strong></td><td>${integer.format(item.sessions)}</td><td>${integer.format(item.productViews)}</td><td>${integer.format(item.added)}</td><td>${integer.format(item.paidOrders)}</td><td class="number">${money.format(item.sales)}</td></tr>`).join("") || emptyRow(6, "No campaign source matches this search.");
}

function renderMonthly(data) {
  const summary = data.summary || {};
  const month = String(data.month || "");
  const monthInput = document.querySelector("[data-monthly-month]");
  if (monthInput && !monthInput.value && /^\d{4}-\d{2}/.test(month)) monthInput.value = month.slice(0, 7);
  setText("[data-monthly-title]", month ? formatMonth(month) : "Current month");
  setText('[data-monthly-metric="sales"]', money.format(summary.cashNetSales || 0));
  setText('[data-monthly-metric="spend"]', money.format(summary.marketingSpend || 0));
  setText('[data-monthly-metric="attributed-sales"]', money.format(summary.attributableRevenue || 0));
  setText('[data-monthly-metric="roas"]', ratio(summary.roas));
  setText('[data-monthly-metric="orders"]', integer.format(summary.paidOrders || 0));
  const previous = data.comparison || {};
  setText('[data-monthly-compare="sales"]', comparisonCopy(summary.cashNetSales, previous.cashNetSales, "vs previous month"));
  setText("[data-monthly-spend-note]", summary.untaggedSpend ? `${money.format(summary.untaggedSpend)} needs a channel or campaign` : "Finance expenses marked Marketing");

  const funnelRows = [
    ["Consented sessions", summary.consentedSessions],
    ["Product views", summary.productViews],
    ["Add to cart", summary.carts],
    ["Checkout created", summary.checkoutCreated],
    ["Paid orders", summary.paidOrders]
  ];
  const max = Math.max(1, ...funnelRows.map(([, value]) => Number(value || 0)));
  const monthlyFunnel = document.querySelector("[data-monthly-funnel]");
  monthlyFunnel.innerHTML = funnelRows.map(([label, value]) => `<div class="funnel-step"><span>${escapeHtml(label)}</span><div class="funnel-track"><i data-bar-width="${Math.max(value ? 2 : 0, Number(value || 0) / max * 100)}"></i></div><strong>${integer.format(value || 0)}</strong></div>`).join("");
  applyDynamicBarSizes(monthlyFunnel);

  const actions = data.actions || {};
  document.querySelectorAll("[data-monthly-action]").forEach((node) => { node.textContent = integer.format(actions[node.dataset.monthlyAction] || 0); });
  const campaigns = sortRows("monthly-campaigns", data.campaigns || [], (item, key) => key === "source" ? sourceName(item) : item[key]);
  const products = sortRows("monthly-products", data.topProducts || [], (item, key) => item[key]);
  document.querySelector("[data-monthly-campaign-table]").innerHTML = campaigns.map((item) => `<tr><td><strong>${escapeHtml(sourceName(item))}</strong></td><td>${integer.format(item.sessions)}</td><td>${money.format(item.spend)}</td><td>${integer.format(item.paidOrders)}</td><td class="number">${money.format(item.sales)}</td><td class="number">${ratio(item.roas)}</td></tr>`).join("") || emptyRow(6, "No campaign, spend, or attributed order data for this month.");
  document.querySelector("[data-monthly-products-table]").innerHTML = products.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.artist || "-")}</td><td>${integer.format(item.productViews)}</td><td>${integer.format(item.productClicks)}</td><td>${integer.format(item.orders)}</td><td class="number">${money.format(item.sales)}</td></tr>`).join("") || emptyRow(6, "No product activity in this month.");
}

function applyDynamicBarSizes(root) {
  root?.querySelectorAll("[data-bar-height], [data-bar-width]").forEach((node) => {
    const height = node.dataset.barHeight;
    const width = node.dataset.barWidth;
    if (height !== undefined) node.style.height = `${Math.max(0, Math.min(100, Number(height) || 0))}%`;
    if (width !== undefined) node.style.width = `${Math.max(0, Math.min(100, Number(width) || 0))}%`;
  });
}

function renderContacts(query = "") {
  const data = state.dashboard;
  if (!data) return;
  setText('[data-contact-metric="known"]', integer.format(data.metrics.knownCustomers));
  setText('[data-contact-metric="consent"]', "0");
  setText('[data-contact-metric="returning"]', integer.format(data.metrics.returningCustomers));
  const needle = query.trim().toLowerCase();
  const rows = sortRows("contacts", data.contacts.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(needle)), (item, key) => {
    if (key === "source") return "Order";
    if (key === "consent") return "Not collected";
    return item[key];
  });
  document.querySelector("[data-contacts-table]").innerHTML = rows.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong><br><span>${escapeHtml(item.email)}</span></td><td>Order</td><td>${formatDate(item.lastOrder)}</td><td>${integer.format(item.orders)}</td><td><span class="consent-badge">Not collected</span></td><td class="number">${money.format(item.sales)}</td></tr>`).join("") || emptyRow(6, "No customer contact matches this search.");
}

function renderData(data) {
  const events = sortRows("events", data.events, (item, key) => item[key]);
  const daily = sortRows("daily", data.daily, (item, key) => item[key]);
  document.querySelector("[data-events-table]").innerHTML = events.map((item) => `<tr><td>${formatDateTime(item.time)}</td><td><strong>${escapeHtml(item.event)}</strong></td><td>${escapeHtml(item.path)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.session)}</td></tr>`).join("") || emptyRow(5, "No consented events in this period.");
  document.querySelector("[data-daily-metrics-table]").innerHTML = daily.map((item) => `<tr><td><strong>${escapeHtml(item.date)}</strong></td><td>${integer.format(item.visitors)}</td><td>${integer.format(item.productViews)}</td><td>${integer.format(item.added)}</td><td>${integer.format(item.orders)}</td><td class="number">${money.format(item.cashNetSales)}</td></tr>`).join("") || emptyRow(6, "No daily metrics in this period.");
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

function sortRows(table, rows, valueFor) {
  const fallback = sortDefaults[table] || { key: "", direction: "asc" };
  const sort = state.sorts[table] || fallback;
  return [...rows].sort((left, right) => {
    const first = valueFor(left, sort.key);
    const second = valueFor(right, sort.key);
    const firstNumber = Number(first);
    const secondNumber = Number(second);
    const numeric = String(first ?? "").trim() !== "" && String(second ?? "").trim() !== "" && Number.isFinite(firstNumber) && Number.isFinite(secondNumber);
    const result = numeric
      ? firstNumber - secondNumber
      : String(first ?? "").localeCompare(String(second ?? ""), "id", { numeric: true, sensitivity: "base" });
    return sort.direction === "desc" ? -result : result;
  });
}

function updateSortIndicators() {
  document.querySelectorAll("[data-sort-table]").forEach((table) => {
    const tableName = table.dataset.sortTable;
    const fallback = sortDefaults[tableName] || { key: "", direction: "asc" };
    const sort = state.sorts[tableName] || fallback;
    table.querySelectorAll("[data-sort-key]").forEach((button) => {
      const active = button.dataset.sortKey === sort.key;
      const heading = button.closest("th");
      heading?.toggleAttribute("data-sort-direction", active);
      if (active && heading) heading.dataset.sortDirection = sort.direction;
      if (!active && heading) delete heading.dataset.sortDirection;
      if (heading) heading.setAttribute("aria-sort", active ? (sort.direction === "asc" ? "ascending" : "descending") : "none");
      button.setAttribute("aria-label", `${button.textContent.trim()}: ${active ? `${sort.direction}ending` : "sort"}`);
    });
  });
}

function refreshSortedTable(table) {
  if (!state.dashboard) return;
  if (table === "products") renderProducts(state.dashboard.products);
  if (table === "opportunities") renderOpportunities(state.dashboard.products);
  if (table === "catalog-products") renderCatalogProducts(state.dashboard.products);
  if (table === "instagram-posts") renderInstagram(state.dashboard);
  if (table === "time-series") renderTimeSeries(state.dashboard.daily || []);
  if (table === "monthly-campaigns" || table === "monthly-products") renderMonthly(state.dashboard.monthly || {});
  if (table === "sources") renderAudience(state.dashboard);
  if (table === "campaigns") renderCampaigns(document.querySelector("[data-campaign-search]").value || "");
  if (table === "contacts") renderContacts(document.querySelector("[data-contact-search]").value || "");
  if (table === "events" || table === "daily") renderData(state.dashboard);
  updateSortIndicators();
}

function exportCsv() {
  const products = state.dashboard?.products || [];
  const rows = [["Product", "Artist", "Product views", "Product clicks", "Added to cart", "Paid orders", "Gross item sales"], ...products.map((item) => [item.title, item.artist, item.productViews, item.productClicks, item.added, item.orders, item.sales])];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `nixp-marketing-${new Date().toISOString().slice(0, 10)}.csv` });
  link.click();
  URL.revokeObjectURL(url);
}

async function exportMonthly(format) {
  const rawReport = state.dashboard?.monthly;
  const report = rawReport && {
    ...rawReport,
    campaigns: sortRows("monthly-campaigns", rawReport.campaigns || [], (item, key) => key === "source" ? sourceName(item) : item[key]),
    topProducts: sortRows("monthly-products", rawReport.topProducts || [], (item, key) => item[key])
  };
  const buttons = document.querySelectorAll("[data-export-monthly-jpg], [data-export-monthly-pdf]");
  if (!report || !window.NIXPMonthlyReportExport) {
    document.querySelector("[data-status-copy]").textContent = "Monthly report is still loading.";
    return;
  }
  buttons.forEach((button) => { button.disabled = true; });
  document.querySelector("[data-status-copy]").textContent = `Preparing ${format.toUpperCase()} monthly report.`;
  try {
    await window.NIXPMonthlyReportExport.download(report, format);
    document.querySelector("[data-status-copy]").textContent = `Monthly report ${format.toUpperCase()} exported.`;
  } catch (error) {
    document.querySelector("[data-status-copy]").textContent = error.message || "Monthly report export failed.";
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
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
document.querySelector("[data-export-monthly-jpg]").addEventListener("click", () => exportMonthly("jpg"));
document.querySelector("[data-export-monthly-pdf]").addEventListener("click", () => exportMonthly("pdf"));
document.querySelector("[data-refresh]").addEventListener("click", loadDashboard);
document.querySelector("[data-logout]").addEventListener("click", async () => { await request("/api/auth/logout", { method: "POST" }).catch(() => {}); showLogin(); });
document.querySelector("[data-period]").addEventListener("change", loadDashboard);
document.querySelector("[data-monthly-month]").addEventListener("change", loadDashboard);
document.querySelector("[data-report-grain]").addEventListener("change", (event) => {
  state.reportGrain = event.target.value;
  renderTimeSeries(state.dashboard?.daily || []);
  updateSortIndicators();
});
document.querySelector("[data-campaign-search]").addEventListener("input", (event) => renderCampaigns(event.target.value));
document.querySelector("[data-contact-search]").addEventListener("input", (event) => renderContacts(event.target.value));
document.querySelector("[data-content-plan-sort]")?.addEventListener("change", (event) => {
  state.contentPlanSort = event.target.value;
  renderContentPlans(state.dashboard?.contentPlans || []);
});
const contentPlanForm = document.querySelector("[data-content-plan-form]");
contentPlanForm?.addEventListener("input", (event) => {
  const tracking = contentPlanForm.elements.trackingContent;
  if (event.target === contentPlanForm.elements.title && tracking.dataset.manual !== "true") tracking.value = contentTrackingId(event.target.value);
  if (event.target === tracking) tracking.dataset.manual = tracking.value ? "true" : "";
  updateContentPlanLinkPreview(contentPlanForm);
});
contentPlanForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("[data-content-plan-message]");
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  setText("[data-content-plan-message]", "Saving content plan...");
  try {
    const action = state.editingContentPlanId ? "PATCH" : "POST";
    const suffix = state.editingContentPlanId ? `&id=${encodeURIComponent(state.editingContentPlanId)}` : "";
    await request(`/api/marketing?resource=content-plans${suffix}`, { method: action, headers: { "content-type": "application/json" }, body: JSON.stringify(contentPlanPayload(form)) });
    resetContentPlanForm();
    await loadDashboard();
  } catch (error) {
    if (message) message.textContent = error.message || "Content plan could not be saved.";
  } finally {
    submit.disabled = false;
  }
});
document.querySelector("[data-content-plan-cancel]")?.addEventListener("click", resetContentPlanForm);
document.addEventListener("click", (event) => {
  const copy = event.target.closest("[data-content-plan-copy]");
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.contentPlanCopy || "").then(() => {
      const original = copy.textContent;
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = original; }, 1200);
    }).catch(() => { document.querySelector("[data-status-copy]").textContent = "Copy the tracking link from the content plan field."; });
    return;
  }
  const edit = event.target.closest("[data-content-plan-edit]");
  if (edit) {
    editContentPlan(edit.dataset.contentPlanEdit || "");
    return;
  }
  const remove = event.target.closest("[data-content-plan-delete]");
  if (remove) {
    const plan = (state.dashboard?.contentPlans || []).find((item) => item.id === remove.dataset.contentPlanDelete);
    if (!plan || !window.confirm(`Delete ${plan.title}? This only removes the plan, not Instagram or website analytics.`)) return;
    request(`/api/marketing?resource=content-plans&id=${encodeURIComponent(plan.id)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" })
      .then(() => { if (state.editingContentPlanId === plan.id) resetContentPlanForm(); return loadDashboard(); })
      .catch((error) => { document.querySelector("[data-status-copy]").textContent = error.message || "Content plan could not be deleted."; });
    return;
  }
  const button = event.target.closest("[data-sort-key]");
  if (!button) return;
  const table = button.closest("[data-sort-table]");
  if (!table) return;
  const tableName = table.dataset.sortTable;
  const previous = state.sorts[tableName] || sortDefaults[tableName] || { key: "", direction: "asc" };
  state.sorts[tableName] = {
    key: button.dataset.sortKey,
    direction: previous.key === button.dataset.sortKey && previous.direction === "asc" ? "desc" : "asc"
  };
  refreshSortedTable(tableName);
});

function setText(selector, value) { const node = document.querySelector(selector); if (node) node.textContent = value; }
function sourceName(item) { return item.campaign ? `${item.source} / ${item.campaign}` : item.source; }
function ratio(value) { return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}x` : "-"; }
function comparisonCopy(current, previous, suffix) { if (!Number.isFinite(Number(previous)) || Number(previous) === 0) return `${suffix}: no prior baseline`; const change = (Number(current || 0) - Number(previous)) / Number(previous); return `${change >= 0 ? "+" : ""}${percent.format(change)} ${suffix}`; }
function formatMonth(value) { return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(`${String(value).slice(0, 7)}-01T00:00:00`)); }
function emptyRow(columns, text) { return `<tr><td colspan="${columns}">${escapeHtml(text)}</td></tr>`; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(value)) : "No order"; }
function formatDateTime(value) { return value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "No data"; }
function formatFreshness(value) { if (!value) return "No events yet"; const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000)); return minutes < 2 ? "Current" : `${minutes} min ago`; }

renderAccountingBasis();
updateContentPlanLinkPreview(contentPlanForm);
boot();
