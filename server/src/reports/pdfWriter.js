import PDFDocument from 'pdfkit';

// Draws the report sections as a PDF. Everything is drawn in black, grays and
// patterns (never colour alone), so a photocopy or a black-and-white printout
// reads as clearly as the screen: bars are outlined, series differ by line style
// and marker shape, year levels differ by hatching, and values are written out.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 42;
const W = PAGE_W - M * 2;
const TOP = 46;
const BOTTOM = PAGE_H - 54;

const INK = '#111111';
const MUTED = '#444444';
const RULE = '#888888';
const GRID = '#bbbbbb';
const BRAND = '#185688'; // prints as a dark gray
const HEAD_FILL = '#e3f0fa'; // prints as a light gray
const STRIPE = '#f2f8fd';
const BOX_FILL = '#f4f4f4';
const BAR_FILL = '#555555';

const number = new Intl.NumberFormat('en-US');

// The built-in PDF fonts cover Western European letters and common punctuation;
// anything else is shown as "?" (the CSV keeps every character).
const pdfSafe = (s) => String(s ?? '').replace(/[^\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122]/g, '?');

function niceTicks(max) {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

// Fill styles for year levels (and anything else that needs telling apart without colour).
const PATTERNS = {
  1: 'solid',
  2: 'light',
  3: 'diag',
  4: 'cross',
  5: 'horiz',
  6: 'dots',
  none: 'back',
};
const patternFor = (level) => PATTERNS[level ?? 'none'] || 'light';

export function renderPdf(res, { title, generated, sections, filename, multi }) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: M,
    bufferPages: true,
    info: { Title: pdfSafe(title), Author: 'PCDS LRC' },
  });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  doc.pipe(res);

  let y = TOP;
  let running = ''; // title shown at the top of a continuation page

  // ---------- text helpers ----------
  function setFont(size, bold = false) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  }
  function heightOf(text, size, bold, width) {
    setFont(size, bold);
    return doc.heightOfString(pdfSafe(text), { width });
  }
  function para(text, { size = 9, bold = false, color = INK, x = M, width = W, gap = 4, align = 'left' } = {}) {
    const h = heightOf(text, size, bold, width);
    ensure(h + gap);
    setFont(size, bold);
    doc.fillColor(color).text(pdfSafe(text), x, y, { width, align });
    y += h + gap;
  }
  function fit(text, width) {
    const t = pdfSafe(text);
    if (doc.widthOfString(t) <= width) return t;
    let s = t;
    while (s.length > 1 && doc.widthOfString(`${s}...`) > width) s = s.slice(0, -1);
    return `${s}...`;
  }
  function wrap(text, width, maxLines) {
    const words = pdfSafe(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && doc.widthOfString(next) > width) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = fit(`${lines[maxLines - 1]} ...`, width);
    }
    return lines.map((l) => fit(l, width));
  }

  function newPage() {
    doc.addPage();
    y = TOP;
    if (running) {
      setFont(8, false);
      doc.fillColor(MUTED).text(`${pdfSafe(running)} (continued)`, M, y, { width: W });
      y += 18;
    }
  }
  function ensure(h) {
    if (y + h > BOTTOM) newPage();
  }

  // ---------- drawing helpers ----------
  function hatch(x, yy, w, h, kind) {
    doc.save();
    doc.rect(x, yy, w, h).clip();
    if (kind === 'solid') {
      doc.rect(x, yy, w, h).fill('#333333');
    } else if (kind === 'light') {
      doc.rect(x, yy, w, h).fill('#cfcfcf');
    } else {
      doc.rect(x, yy, w, h).fill('#ffffff');
      doc.lineWidth(0.6).strokeColor('#222222');
      const gap = 3.2;
      if (kind === 'diag' || kind === 'cross') {
        for (let i = -h; i < w; i += gap) doc.moveTo(x + i, yy + h).lineTo(x + i + h, yy).stroke();
      }
      if (kind === 'back' || kind === 'cross') {
        for (let i = -h; i < w; i += gap) doc.moveTo(x + i, yy).lineTo(x + i + h, yy + h).stroke();
      }
      if (kind === 'horiz') {
        for (let k = yy + 1.5; k < yy + h; k += gap) doc.moveTo(x, k).lineTo(x + w, k).stroke();
      }
      if (kind === 'dots') {
        for (let a = x + 2; a < x + w; a += 3.6) for (let b = yy + 2; b < yy + h; b += 3.6) doc.circle(a, b, 0.7).fill('#222222');
      }
    }
    doc.restore();
    doc.lineWidth(0.6).strokeColor('#000000').rect(x, yy, w, h).stroke();
  }

  function marker(shape, cx, cy, r = 3) {
    doc.lineWidth(0.9).strokeColor('#000000');
    if (shape === 0) doc.circle(cx, cy, r).fillAndStroke('#000000', '#000000');
    else if (shape === 1) doc.rect(cx - r, cy - r, r * 2, r * 2).fillAndStroke('#ffffff', '#000000');
    else if (shape === 2) doc.polygon([cx, cy - r - 0.5], [cx + r + 0.5, cy + r], [cx - r - 0.5, cy + r]).fillAndStroke('#000000', '#000000');
    else doc.polygon([cx, cy - r - 1], [cx + r + 1, cy], [cx, cy + r + 1], [cx - r - 1, cy]).fillAndStroke('#ffffff', '#000000');
  }
  const DASHES = [null, [5, 3], [1.5, 2.5], [9, 3]];

  function chartTitle(text) {
    para(text, { size: 10.5, bold: true, gap: 6 });
  }

  // ---------- charts ----------
  function axisSetup(plot, max) {
    const ticks = niceTicks(max);
    const top = ticks[ticks.length - 1] || 1;
    setFont(7);
    doc.lineWidth(0.5).strokeColor(GRID);
    for (const t of ticks) {
      const yy = plot.y1 - (t / top) * (plot.y1 - plot.y0);
      doc.dash(2, { space: 2 }).moveTo(plot.x0, yy).lineTo(plot.x1, yy).stroke().undash();
      doc.fillColor(MUTED).text(number.format(t), M, yy - 3, { width: plot.x0 - M - 5, align: 'right', lineBreak: false });
    }
    doc.lineWidth(0.9).strokeColor('#000000').moveTo(plot.x0, plot.y0).lineTo(plot.x0, plot.y1).lineTo(plot.x1, plot.y1).stroke();
    return top;
  }

  function xLabels(plot, labels, slot, centers) {
    setFont(7);
    const widest = Math.max(...labels.map((l) => doc.widthOfString(pdfSafe(l))), 1);
    const step = Math.max(1, Math.ceil((widest + 5) / slot));
    labels.forEach((l, i) => {
      if (i % step !== 0) return;
      const cx = centers[i];
      doc.fillColor(INK).text(pdfSafe(l), cx - slot * step / 2, plot.y1 + 5, { width: slot * step, align: 'center', lineBreak: false });
    });
  }

  function barsChart(c) {
    const height = 200;
    chartTitle(c.title);
    ensure(height + 8);
    const plot = { x0: M + 38, x1: M + W, y0: y + 12, y1: y + height - 24 };
    const max = Math.max(...c.items.map((i) => (i.future ? 0 : i.value)), 0);
    const top = axisSetup(plot, max);
    setFont(7);
    doc.fillColor(MUTED).text('Visits', M, y, { width: 60, lineBreak: false });

    const n = c.items.length;
    const slot = (plot.x1 - plot.x0) / n;
    const bw = Math.min(slot * 0.68, 34);
    const centers = c.items.map((_, i) => plot.x0 + slot * (i + 0.5));
    const labelRoom = Math.max(...c.items.map((i) => doc.widthOfString(number.format(i.value)))) + 3 <= slot;
    c.items.forEach((it, i) => {
      if (it.future) return;
      if (it.closed) {
        setFont(6.5);
        doc.fillColor(MUTED).text('Closed', centers[i] - slot / 2, plot.y1 - 10, { width: slot, align: 'center', lineBreak: false });
        return;
      }
      const h = (it.value / top) * (plot.y1 - plot.y0);
      if (h > 0) {
        doc.rect(centers[i] - bw / 2, plot.y1 - h, bw, h).fillAndStroke(BAR_FILL, '#000000');
      }
      if (labelRoom && n <= 31) {
        setFont(7);
        doc.fillColor(INK).text(number.format(it.value), centers[i] - slot / 2, plot.y1 - h - 9, { width: slot, align: 'center', lineBreak: false });
      }
    });
    xLabels(plot, c.items.map((i) => i.axis), slot, centers);
    y += height + 6;
  }

  function linesChart(c) {
    const height = 210;
    chartTitle(c.title);
    const multi = c.series.length > 1;
    ensure(height + (multi ? 18 : 0) + 8);

    if (multi) {
      let lx = M + 38;
      c.series.forEach((s, i) => {
        setFont(8.5, true);
        const w = doc.widthOfString(pdfSafe(s.name));
        doc.lineWidth(1.4).strokeColor('#000000');
        if (DASHES[i % 4]) doc.dash(DASHES[i % 4][0], { space: DASHES[i % 4][1] });
        doc.moveTo(lx, y + 5).lineTo(lx + 26, y + 5).stroke().undash();
        marker(i % 4, lx + 13, y + 5);
        doc.fillColor(INK).text(pdfSafe(s.name), lx + 32, y + 1, { lineBreak: false });
        lx += 32 + w + 22;
      });
      y += 18;
    }

    const plot = { x0: M + 38, x1: M + W, y0: y + 12, y1: y + height - 24 };
    const max = Math.max(...c.series.flatMap((s) => s.points.filter((p) => !p.future).map((p) => p.value)), 0);
    const top = axisSetup(plot, max);
    setFont(7);
    doc.fillColor(MUTED).text('Visits', M, y, { width: 60, lineBreak: false });

    const n = c.axis.length;
    const slot = (plot.x1 - plot.x0) / n;
    const centers = c.axis.map((_, i) => plot.x0 + slot * (i + 0.5));
    const yOf = (v) => plot.y1 - (v / top) * (plot.y1 - plot.y0);

    c.series.forEach((s, si) => {
      const dash = DASHES[si % 4];
      doc.lineWidth(1.4).strokeColor('#000000');
      if (dash) doc.dash(dash[0], { space: dash[1] });
      let started = false;
      s.points.forEach((p, i) => {
        if (p.future) return;
        const px = centers[i];
        const py = yOf(p.value);
        if (!started) {
          doc.moveTo(px, py);
          started = true;
        } else doc.lineTo(px, py);
      });
      if (started) doc.stroke();
      doc.undash();
      const showMarks = n <= 31 || multi;
      s.points.forEach((p, i) => {
        if (p.future) return;
        if (showMarks) marker(si % 4, centers[i], yOf(p.value), n > 20 ? 2.2 : 3);
        if (!multi && n <= 12) {
          setFont(7);
          doc.fillColor(INK).text(number.format(p.value), centers[i] - slot / 2, yOf(p.value) - 12, { width: slot, align: 'center', lineBreak: false });
        }
      });
    });
    xLabels(plot, c.axis, slot, centers);
    y += height + 6;
  }

  function hbarsChart(c) {
    chartTitle(c.title);
    const labelW = 200;
    const valueW = 86;
    const x0 = M + labelW + 6;
    const trackW = W - labelW - valueW - 12;
    const max = Math.max(...c.items.map((i) => i.value), 1);
    c.items.forEach((it, idx) => {
      setFont(8.5);
      const lines = wrap(it.label, labelW, 2);
      const h = Math.max(16, lines.length * 10 + 6);
      ensure(h + (idx === 0 ? 10 : 0));
      lines.forEach((l, k) => doc.fillColor(INK).text(l, M, y + 3 + k * 10, { width: labelW, lineBreak: false }));
      doc.lineWidth(0.5).strokeColor(RULE).rect(x0, y + 2, trackW, h - 6).stroke();
      const bw = (it.value / max) * trackW;
      if (bw > 0) doc.rect(x0, y + 2, bw, h - 6).fillAndStroke(BAR_FILL, '#000000');
      doc.fillColor(INK).text(`${number.format(it.value)} (${it.share})`, x0 + trackW + 6, y + 3, { width: valueW, align: 'left', lineBreak: false });
      y += h;
    });
    y += 8;
  }

  function stackedChart(c) {
    chartTitle(c.title);
    // Legend: one hatched swatch per year level.
    setFont(8);
    let lx = M;
    ensure(26);
    c.levels.forEach((l) => {
      const w = doc.widthOfString(pdfSafe(l.label)) + 30;
      if (lx + w > M + W) {
        lx = M;
        y += 16;
        ensure(16);
      }
      hatch(lx, y, 18, 10, patternFor(l.level));
      doc.fillColor(INK).text(pdfSafe(l.label), lx + 23, y + 1, { lineBreak: false });
      lx += w + 8;
    });
    y += 18;

    const labelW = 200;
    const valueW = 86;
    const x0 = M + labelW + 6;
    const trackW = W - labelW - valueW - 12;
    const max = Math.max(...c.items.map((i) => i.total), 1);
    c.items.forEach((it) => {
      setFont(8.5);
      const lines = wrap(it.label, labelW, 2);
      const h = Math.max(16, lines.length * 10 + 6);
      ensure(h);
      lines.forEach((l, k) => doc.fillColor(INK).text(l, M, y + 3 + k * 10, { width: labelW, lineBreak: false }));
      doc.lineWidth(0.5).strokeColor(RULE).rect(x0, y + 2, trackW, h - 6).stroke();
      let sx = x0;
      for (const l of c.levels) {
        const v = it.parts[l.key] || 0;
        if (v <= 0) continue;
        const w = (v / max) * trackW;
        hatch(sx, y + 2, w, h - 6, patternFor(l.level));
        sx += w;
      }
      doc.fillColor(INK).text(number.format(it.total), x0 + trackW + 6, y + 3, { width: valueW, lineBreak: false });
      y += h;
    });
    y += 8;
  }

  const CHARTS = { bars: barsChart, lines: linesChart, hbars: hbarsChart, stacked: stackedChart };

  // ---------- tables ----------
  function table(t) {
    const total = t.columns.reduce((n, c) => n + (c.weight || 1), 0);
    const widths = t.columns.map((c) => (W * (c.weight || 1)) / total);
    const pad = 5;
    const fmt = (v) => (v === null || v === undefined ? '-' : typeof v === 'number' ? number.format(v) : String(v));

    function cellLines(value, i) {
      const text = fmt(value);
      setFont(8.5, false);
      return t.columns[i].num ? [fit(text, widths[i] - pad * 2)] : wrap(text, widths[i] - pad * 2, 3);
    }
    function drawRow(cells, { bold = false, fill = null, topRule = false, header = false } = {}) {
      setFont(8.5, bold);
      // Column headings wrap instead of being cut short, so "Year not recorded" stays whole.
      const lines = cells.map((v, i) => (header ? wrap(fmt(v), widths[i] - pad * 2, 2) : cellLines(v, i)));
      const h = Math.max(...lines.map((l) => l.length)) * 10.5 + 7;
      if (y + h > BOTTOM) {
        newPage();
        drawHeader();
      }
      if (fill) doc.rect(M, y, W, h).fill(fill);
      if (topRule) doc.lineWidth(0.9).strokeColor('#000000').moveTo(M, y).lineTo(M + W, y).stroke();
      setFont(8.5, bold);
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((l, k) =>
          doc.fillColor(INK).text(l, x + pad, y + 3.5 + k * 10.5, { width: widths[i] - pad * 2, align: t.columns[i].num ? 'right' : 'left', lineBreak: false })
        );
        x += widths[i];
      });
      doc.lineWidth(0.4).strokeColor('#cccccc').moveTo(M, y + h).lineTo(M + W, y + h).stroke();
      y += h;
    }
    function drawHeader() {
      drawRow(
        t.columns.map((c) => c.label),
        { bold: true, fill: HEAD_FILL, header: true }
      );
    }

    para(t.title, { size: 10.5, bold: true, gap: 5 });
    ensure(60);
    drawHeader();
    t.rows.forEach((r, i) => drawRow(r, { fill: i % 2 ? STRIPE : null }));
    if (t.footer) drawRow(t.footer, { bold: true, topRule: true });
    y += 12;
  }

  // ---------- page furniture ----------
  function reportHeader() {
    setFont(9, true);
    doc.fillColor(MUTED).text('PCDS LRC', M, y, { characterSpacing: 1.5, lineBreak: false });
    y += 13;
    setFont(19, true);
    doc.fillColor(BRAND).text(pdfSafe(multi ? 'Analytics Report: All Charts' : 'Analytics Report'), M, y, { lineBreak: false });
    y += 26;
    setFont(9);
    doc.fillColor(MUTED).text(`Generated ${pdfSafe(generated)}`, M, y, { lineBreak: false });
    y += 13;
    doc.lineWidth(1.5).strokeColor('#000000').moveTo(M, y).lineTo(M + W, y).stroke();
    y += 14;
  }

  function filterBox(s) {
    const labelW = 112;
    const valueW = W - labelW - 20;
    const rows = s.filters;
    setFont(8.5);
    const layout = rows.map(([label, value]) => {
      const lines = wrap(value, valueW, 4);
      return { label, lines, h: lines.length * 10.5 + 3 };
    });
    const boxH = layout.reduce((n, r) => n + r.h, 0) + 14;
    ensure(boxH + 8);
    doc.rect(M, y, W, boxH).fill(BOX_FILL);
    doc.lineWidth(0.6).strokeColor('#000000').rect(M, y, W, boxH).stroke();
    let yy = y + 7;
    for (const r of layout) {
      setFont(8.5, true);
      doc.fillColor(INK).text(pdfSafe(r.label), M + 10, yy, { width: labelW - 6, lineBreak: false });
      setFont(8.5);
      r.lines.forEach((l, k) => doc.fillColor(INK).text(l, M + 10 + labelW, yy + k * 10.5, { width: valueW, lineBreak: false }));
      yy += r.h;
    }
    y += boxH + 10;
  }

  function section(s, first) {
    if (!first) newPageForSection();
    running = s.title;
    para(s.title, { size: 15, bold: true, gap: 3 });
    para(s.description, { size: 8.5, color: MUTED, gap: 8 });
    filterBox(s);
    para(s.summary, { size: 10.5, bold: true, gap: 6 });
    for (const n of s.notes) para(n, { size: 8.5, color: MUTED, gap: 3 });
    if (s.notes.length) y += 4;

    if (s.emptyText) para(s.emptyText, { size: 10, color: MUTED, gap: 10 });
    for (const c of s.charts) {
      CHARTS[c.kind](c);
      y += 4;
    }
    for (const t of s.tables) table(t);
  }
  function newPageForSection() {
    running = '';
    doc.addPage();
    y = TOP;
  }

  reportHeader();
  sections.forEach((s, i) => section(s, i === 0));

  // Page numbers go on last, once the page count is known. The bottom margin is
  // lifted while writing them so they do not start a new page.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.lineWidth(0.5).strokeColor(RULE).moveTo(M, PAGE_H - 42).lineTo(M + W, PAGE_H - 42).stroke();
    setFont(8);
    doc.fillColor(MUTED).text('PCDS LRC - Analytics Report', M, PAGE_H - 34, { width: W / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, M + W / 2, PAGE_H - 34, { width: W / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = saved;
  }

  doc.end();
}
