// Quotes one cell. A cell that starts with = + - or @ would be run as a formula by
// a spreadsheet, so it gets a leading apostrophe.
function cell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const line = (cells) => cells.map(cell).join(',');

// The period and filters come first, then each table of the chart, with the
// same rows the PDF prints. Numbers are written plain (no thousands separators).
export function csvBody({ generated, sections }) {
  const s = sections[0];
  const lines = [
    line(['PCDS LRC Analytics Report']),
    line(['Report', s.title]),
    line(['Generated', generated]),
    ...s.filters.map(([label, value]) => line([label, value])),
    line(['Summary', s.summary]),
    ...s.notes.map((n) => line(['Note', n])),
  ];
  if (s.emptyText) lines.push(line(['Note', s.emptyText]));

  for (const t of s.tables) {
    lines.push('', line([t.title]), line(t.columns.map((c) => c.label)));
    for (const row of t.rows) lines.push(line(row));
    if (t.footer) lines.push(line(t.footer));
  }
  // The byte order mark makes Excel read the file as UTF-8, so names keep their accents.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
