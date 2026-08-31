(function () {
  const WIDTH = 1600;
  const HEIGHT = 2200;
  const PAPER = "#f1f1f1";
  const INK = "#292929";
  const MUTED = "#737373";
  const LINE = "#bdbdbd";
  const FONT = "Founders Grotesk Web, Helvetica Neue, Arial, sans-serif";

  function escapeXml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]));
  }

  function truncate(value, length = 34) {
    const text = String(value ?? "-");
    return text.length > length ? `${text.slice(0, Math.max(1, length - 1))}...` : text;
  }

  function number(value) {
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function money(value) {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function ratio(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}x` : "-";
  }

  function monthLabel(value) {
    const month = String(value || "");
    if (!/^\d{4}-\d{2}/.test(month)) return "Current month";
    return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(`${month.slice(0, 7)}-01T00:00:00`));
  }

  function line(x1, y1, x2, y2, stroke = LINE) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1" />`;
  }

  function text(value, x, y, options = {}) {
    const { size = 22, weight = 400, fill = INK, anchor = "start", letterSpacing = 0 } = options;
    return `<text x="${x}" y="${y}" fill="${fill}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${letterSpacing}">${escapeXml(value)}</text>`;
  }

  function metricCard({ x, y, label, value, note }) {
    return [
      `<rect x="${x}" y="${y}" width="340" height="196" fill="#f8f8f8" stroke="${LINE}" />`,
      text(label.toUpperCase(), x + 20, y + 30, { size: 14, weight: 700, fill: MUTED, letterSpacing: 1.1 }),
      text(value, x + 20, y + 105, { size: 42, weight: 600 }),
      text(truncate(note, 42), x + 20, y + 163, { size: 15, fill: MUTED })
    ].join("");
  }

  function table({ x, y, width, title, eyebrow, columns, rows, rowHeight = 46, maxRows = 8 }) {
    const selectedRows = rows.slice(0, maxRows);
    const headerY = y + 76;
    let result = `<rect x="${x}" y="${y}" width="${width}" height="${104 + Math.max(selectedRows.length, 1) * rowHeight}" fill="#f8f8f8" stroke="${LINE}" />`;
    result += text(eyebrow.toUpperCase(), x + 20, y + 29, { size: 13, weight: 700, fill: MUTED, letterSpacing: 1 });
    result += text(title, x + 20, y + 58, { size: 24, weight: 600 });
    result += line(x + 20, headerY, x + width - 20, headerY);
    columns.forEach((column) => {
      const cellX = x + width * column.position;
      result += text(column.label.toUpperCase(), cellX, headerY + 25, { size: 12, weight: 700, fill: MUTED, anchor: column.anchor || "start", letterSpacing: .7 });
    });
    selectedRows.forEach((row, index) => {
      const rowY = headerY + 48 + index * rowHeight;
      result += line(x + 20, rowY + 14, x + width - 20, rowY + 14);
      columns.forEach((column) => {
        result += text(truncate(column.value(row), column.length || 28), x + width * column.position, rowY, { size: 14, weight: column.strong ? 600 : 400, anchor: column.anchor || "start", fill: column.muted ? MUTED : INK });
      });
    });
    if (!selectedRows.length) result += text("No measured data for this month.", x + 20, headerY + 58, { size: 15, fill: MUTED });
    return result;
  }

  function reportSvg(report) {
    const summary = report.summary || {};
    const actions = report.actions || {};
    const funnel = [
      ["Consented sessions", summary.consentedSessions],
      ["Product views", summary.productViews],
      ["Add to cart", summary.carts],
      ["Checkout created", summary.checkoutCreated],
      ["Paid orders", summary.paidOrders]
    ];
    const maxFunnel = Math.max(1, ...funnel.map(([, value]) => Number(value || 0)));
    const campaigns = Array.isArray(report.campaigns) ? report.campaigns : [];
    const products = Array.isArray(report.topProducts) ? report.topProducts : [];
    const generated = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short" }).format(new Date());
    const left = 80;
    const right = WIDTH - 80;
    const metricY = 274;
    const cards = [
      ["Cash net sales", money(summary.cashNetSales), "Verified payments minus refunds"],
      ["Marketing spend", money(summary.marketingSpend), summary.untaggedSpend ? `${money(summary.untaggedSpend)} without channel` : "Finance Marketing expenses"],
      ["Attributed revenue", money(summary.attributableRevenue), "Consented order attribution"],
      ["ROAS", ratio(summary.roas), "Attributed revenue / tagged spend"]
    ];
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="100%" height="100%" fill="${PAPER}" />`;
    svg += text("NIXP", left, 78, { size: 22, weight: 700, letterSpacing: .8 });
    svg += text("MARKETING / PRIVATE", right, 78, { size: 14, weight: 700, fill: MUTED, anchor: "end", letterSpacing: 1.1 });
    svg += line(left, 106, right, 106, INK);
    svg += text("MONTHLY REPORT", left, 162, { size: 16, weight: 700, fill: MUTED, letterSpacing: 1.3 });
    svg += text("Marketing review", left, 234, { size: 66, weight: 600 });
    svg += text(monthLabel(report.month), right, 226, { size: 25, weight: 600, anchor: "end" });
    cards.forEach((card, index) => { svg += metricCard({ x: left + index * 360, y: metricY, label: card[0], value: card[1], note: card[2] }); });

    const funnelY = 520;
    svg += `<rect x="${left}" y="${funnelY}" width="870" height="430" fill="#f8f8f8" stroke="${LINE}" />`;
    svg += text("FUNNEL", left + 20, funnelY + 31, { size: 13, weight: 700, fill: MUTED, letterSpacing: 1 });
    svg += text("Measured month", left + 20, funnelY + 61, { size: 24, weight: 600 });
    funnel.forEach(([label, value], index) => {
      const y = funnelY + 112 + index * 58;
      const width = Math.max(value ? 8 : 0, Number(value || 0) / maxFunnel * 470);
      svg += line(left + 20, y - 19, left + 850, y - 19);
      svg += text(label, left + 20, y + 4, { size: 16, weight: 600 });
      svg += `<rect x="${left + 285}" y="${y - 14}" width="500" height="21" fill="#e5e5e5" />`;
      svg += `<rect x="${left + 285}" y="${y - 14}" width="${width}" height="21" fill="${INK}" />`;
      svg += text(number(value), left + 830, y + 4, { size: 18, weight: 600, anchor: "end" });
    });

    const actionX = 980;
    svg += `<rect x="${actionX}" y="${funnelY}" width="540" height="430" fill="#f8f8f8" stroke="${LINE}" />`;
    svg += text("ACTIONS", actionX + 20, funnelY + 31, { size: 13, weight: 700, fill: MUTED, letterSpacing: 1 });
    svg += text("High-intent signals", actionX + 20, funnelY + 61, { size: 24, weight: 600 });
    [["Item requests", actions.request_item_submitted], ["Offers", actions.offer_submitted], ["Social clicks", actions.social_outbound_click], ["Paid orders", summary.paidOrders]].forEach(([label, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = actionX + 20 + column * 250;
      const y = funnelY + 152 + row * 150;
      svg += line(x, y - 26, x + 220, y - 26);
      svg += text(number(value), x, y + 27, { size: 42, weight: 600 });
      svg += text(label.toUpperCase(), x, y + 60, { size: 13, weight: 700, fill: MUTED, letterSpacing: .8 });
    });

    svg += table({
      x: left,
      y: 990,
      width: 1440,
      eyebrow: "Campaign efficiency",
      title: "Source, spend, and attributable return",
      columns: [
        { label: "Source / campaign", position: .015, value: (row) => row.campaign ? `${row.source} / ${row.campaign}` : row.source, strong: true, length: 40 },
        { label: "Sessions", position: .48, value: (row) => number(row.sessions), anchor: "end" },
        { label: "Spend", position: .65, value: (row) => money(row.spend), anchor: "end" },
        { label: "Revenue", position: .83, value: (row) => money(row.sales), anchor: "end" },
        { label: "ROAS", position: .98, value: (row) => ratio(row.roas), anchor: "end" }
      ],
      rows: campaigns
    });
    svg += table({
      x: left,
      y: 1515,
      width: 1440,
      eyebrow: "Merchandise",
      title: "Month leaders",
      columns: [
        { label: "Product", position: .015, value: (row) => row.title, strong: true, length: 38 },
        { label: "Artist", position: .40, value: (row) => row.artist || "-", length: 26 },
        { label: "Views", position: .64, value: (row) => number(row.productViews), anchor: "end" },
        { label: "Clicks", position: .74, value: (row) => number(row.productClicks), anchor: "end" },
        { label: "Orders", position: .84, value: (row) => number(row.orders), anchor: "end" },
        { label: "Gross sales", position: .98, value: (row) => money(row.sales), anchor: "end" }
      ],
      rows: products
    });
    svg += line(left, 2120, right, 2120, INK);
    svg += text("NIXP MARKETING ANALYTICS", left, 2160, { size: 13, weight: 700, fill: MUTED, letterSpacing: 1 });
    svg += text("Commerce figures are verified. Behavioural figures only include consented sessions.", left, 2189, { size: 14, fill: MUTED });
    svg += text(`Generated ${generated}`, right, 2189, { size: 14, fill: MUTED, anchor: "end" });
    svg += "</svg>";
    return svg;
  }

  async function canvasFromSvg(svg) {
    if (document.fonts?.ready) await document.fonts.ready;
    const image = new Image();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const sourceUrl = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = sourceUrl; });
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = PAPER;
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.drawImage(image, 0, 0, WIDTH, HEIGHT);
      return canvas;
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function concatBytes(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => { output.set(part, offset); offset += part.length; });
    return output;
  }

  function bytes(value) {
    return new TextEncoder().encode(value);
  }

  function jpegBytes(canvas) {
    const encoded = canvas.toDataURL("image/jpeg", .94).split(",")[1];
    const binary = atob(encoded);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
    return output;
  }

  function pdfFromCanvas(canvas) {
    const image = jpegBytes(canvas);
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const imageHeight = pageWidth * HEIGHT / WIDTH;
    const content = bytes(`q\n${pageWidth.toFixed(2)} 0 0 -${imageHeight.toFixed(2)} 0 ${imageHeight.toFixed(2)} cm\n/Im0 Do\nQ\n`);
    const objects = [
      bytes("<< /Type /Catalog /Pages 2 0 R >>"),
      bytes("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
      concatBytes([bytes(`<< /Type /XObject /Subtype /Image /Width ${WIDTH} /Height ${HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, bytes("\nendstream")]),
      concatBytes([bytes(`<< /Length ${content.length} >>\nstream\n`), content, bytes("endstream")])
    ];
    const header = bytes("%PDF-1.4\n%\xD3\xF4\xCC\xE1\n");
    const sections = [header];
    const offsets = [0];
    let offset = header.length;
    objects.forEach((object, index) => {
      offsets.push(offset);
      const objectStart = bytes(`${index + 1} 0 obj\n`);
      const objectEnd = bytes("\nendobj\n");
      sections.push(objectStart, object, objectEnd);
      offset += objectStart.length + object.length + objectEnd.length;
    });
    const xrefOffset = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((item) => { xref += `${String(item).padStart(10, "0")} 00000 n \n`; });
    sections.push(bytes(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
    return new Blob([concatBytes(sections)], { type: "application/pdf" });
  }

  async function download(report, format) {
    const canvas = await canvasFromSvg(reportSvg(report));
    const stamp = String(report.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
    if (format === "jpg") {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .94));
      if (!blob) throw new Error("Monthly report image could not be generated.");
      downloadBlob(blob, `nixp-monthly-report-${stamp}.jpg`);
      return;
    }
    downloadBlob(pdfFromCanvas(canvas), `nixp-monthly-report-${stamp}.pdf`);
  }

  window.NIXPMonthlyReportExport = { download };
})();
