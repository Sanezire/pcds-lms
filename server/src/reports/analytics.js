import { config } from '../config.js';
import { httpError } from '../middleware/auth.js';
import { visitsData, trendsData, peakData, programYearData } from '../routes/statistics.js';
import { DEFAULT_OPTIONS } from './request.js';

// Turns the numbers behind each Analytics chart into "sections": a title, the
// period and filters, a chart description and the data tables. The PDF and CSV
// writers both read the same sections, so the two files always agree. Every
// figure comes from the same functions that feed the charts on screen.

const number = new Intl.NumberFormat('en-US');
const visitsText = (n) => `${number.format(n)} ${n === 1 ? 'visit' : 'visits'}`;
const percent = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '0.0%');

const utc = (opts) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
  return (d) => f.format(d);
};
// Keys are school days (YYYY-MM-DD), months (YYYY-MM) or years (YYYY).
const dateOf = (key) =>
  new Date(key.length === 7 ? `${key}-01T00:00:00Z` : key.length === 4 ? `${key}-01-01T00:00:00Z` : `${key}T00:00:00Z`);
const fmtKey = (opts) => {
  const f = utc(opts);
  return (key) => f(dateOf(key));
};
const dayMedium = fmtKey({ dateStyle: 'medium' });
const dayLong = fmtKey({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const dayMonth = fmtKey({ month: 'short', day: 'numeric' });
const dayNum = fmtKey({ day: 'numeric' });
const monthShort = fmtKey({ month: 'short' });
const monthName = fmtKey({ month: 'long' });
const monthYear = fmtKey({ month: 'long', year: 'numeric' });
const weekdayDate = (d) => new Date(Date.UTC(2024, 0, 1 + d)); // 1 Jan 2024 was a Monday
const weekdayLong = (d) => utc({ weekday: 'long' })(weekdayDate(d));
const weekdayShort = (d) => utc({ weekday: 'short' })(weekdayDate(d));

const hourText = (h) => `${h % 12 || 12}:00 ${h % 24 < 12 ? 'AM' : 'PM'}`;
const hourShort = (h) => `${h % 12 || 12} ${h % 24 < 12 ? 'AM' : 'PM'}`;
const hourRange = (h) => `${hourText(h)}-${hourText(h + 1)}`;

function yearLabel(level) {
  if (level === null || level === undefined) return 'Year not recorded';
  const n = Number(level);
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix} Year`;
}

const SUMMARY_RANGE_LABELS = {
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  month: 'This month',
  last90: 'Last 90 days',
  year: 'This year',
  custom: 'Custom range',
};
const PROGRAM_RANGE_LABELS = {
  all: 'All time',
  year: 'This year',
  lastYear: 'Last year',
  last90: 'Last 90 days',
  month: 'This month',
  last30: 'Last 30 days',
  custom: 'Custom range',
};
const TREND_LABELS = {
  daily: 'Daily summary',
  monthly: 'Monthly summary',
  annual: 'Annual summary',
  compare: 'Compare years',
  custom: 'Custom date range',
};

// When the report was made, on the school's clock (the same one the days are counted on).
export function generatedStamp(now = new Date()) {
  const offset = Math.trunc(config.attendance.utcOffsetMinutes);
  const iso = new Date(now.getTime() + offset * 60 * 1000).toISOString();
  const abs = Math.abs(offset);
  const minutes = abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : '';
  const zone = `UTC${offset < 0 ? '-' : '+'}${Math.floor(abs / 60)}${minutes}`;
  return `${dayMedium(iso.slice(0, 10))} ${iso.slice(11, 16)} (${zone})`;
}

export const fileDate = (now = new Date()) =>
  new Date(now.getTime() + Math.trunc(config.attendance.utcOffsetMinutes) * 60 * 1000).toISOString().slice(0, 10);

// ---- Library Visit Summary ----

async function summarySection(opts) {
  const data = await visitsData(opts.query);
  const daily = data.granularity === 'day';
  const manyYears = data.bars.length > 12;
  const items = data.bars.map((b) => ({
    label: daily ? dayLong(b.key) : monthYear(b.key),
    axis: daily ? (data.bars.length <= 8 ? dayMonth(b.key) : dayNum(b.key)) : monthShort(b.key) + (manyYears ? ` ${b.key.slice(2, 4)}` : ''),
    value: b.visits,
  }));
  const period = `${dayMedium(data.from)} to ${dayMedium(data.to)}`;
  const s = data.summary;

  return {
    id: 'summary',
    title: 'Library Visit Summary',
    description:
      'Students who visited the library in the selected period. A student who times in and out several times in one day counts as one visit.',
    period,
    filters: [['Period', `${SUMMARY_RANGE_LABELS[opts.query.range]} (${period})`]],
    summary: `${visitsText(data.periodTotal)} from ${period}`,
    notes: [`The key figures below are counted up to today (${dayMedium(data.today)}), whatever period is selected.`],
    charts: data.periodTotal > 0 ? [{ kind: 'bars', title: daily ? 'Visits per day' : 'Visits per month', items }] : [],
    emptyText: data.periodTotal > 0 ? null : 'No visits were recorded in this period.',
    tables: [
      {
        title: 'Key figures',
        columns: [
          { label: 'Metric', weight: 3 },
          { label: 'Result', weight: 1, num: true },
        ],
        rows: [
          ['Total library visits', s.total],
          ['Visits this month', s.thisMonth],
          ['Visits this week', s.thisWeek],
          ['Visits today', s.today],
        ],
      },
      {
        title: daily ? 'Visits per day' : 'Visits per month',
        columns: [
          { label: daily ? 'Date' : 'Month', weight: 3 },
          { label: 'Total Visits', weight: 1, num: true },
        ],
        rows: items.map((i) => [i.label, i.value]),
        footer: ['Total', data.periodTotal],
      },
    ],
    audit: `${SUMMARY_RANGE_LABELS[opts.query.range]} (${period})`,
  };
}

// ---- Library Visit Trends ----

async function trendsSection(opts) {
  const data = await trendsData(opts.query);
  const report = data.report;
  const g = data.granularity;

  let heading;
  let period;
  const filters = [['Reporting period', TREND_LABELS[report]]];
  if (report === 'daily') {
    heading = `Daily library visits for ${monthYear(data.label)}`;
    period = monthYear(data.label);
    filters.push(['Month', period]);
  } else if (report === 'monthly') {
    heading = `Monthly library visits for ${data.label}`;
    period = data.label;
    filters.push(['Year', data.label]);
  } else if (report === 'annual') {
    heading = 'Yearly library visits';
    period = `${data.buckets[0].key} to ${data.buckets[data.buckets.length - 1].key}`;
    filters.push(['Years', period]);
  } else if (report === 'compare') {
    heading = `Monthly library visits: ${data.label}`;
    period = data.label;
    filters.push(['Years compared', data.label]);
  } else {
    period = `${dayMedium(data.from)} to ${dayMedium(data.to)}`;
    heading = `Library visits from ${period}`;
    filters.push(['From', dayMedium(data.from)], ['To', dayMedium(data.to)]);
  }

  // Same default as the screen: lines for daily and compare, bars otherwise.
  const type = data.series ? 'line' : opts.chartType || (g === 'day' ? 'line' : 'bar');
  filters.push(['Chart', type === 'line' ? 'Line' : 'Bar']);

  const rowLabel = g === 'day' ? 'Date' : g === 'year' ? 'Year' : 'Month';
  const bucketLabel = (b) =>
    g === 'day' ? dayLong(b.key) : g === 'year' ? b.key : report === 'custom' ? `${monthName(b.key)} ${b.key.slice(0, 4)}` : monthName(b.key);
  const axisOf = (b, n) => {
    if (g === 'day') return n <= 8 ? dayMonth(b.key) : dayNum(b.key);
    if (g === 'year') return b.key;
    return monthShort(b.key) + (n > 12 ? ` ${b.key.slice(2, 4)}` : '');
  };

  let chart = null;
  let tables;
  if (data.series) {
    const n = data.series[0].buckets.length;
    chart = {
      kind: 'lines',
      title: heading,
      axis: data.series[0].buckets.map((b) => monthShort(b.key)),
      series: data.series.map((s) => ({
        name: String(s.year),
        points: s.buckets.map((b) => ({ label: monthName(b.key), value: b.visits, future: b.future })),
      })),
    };
    tables = [
      {
        title: 'Visits per month',
        columns: [
          { label: 'Month', weight: 2 },
          ...data.series.map((s) => ({ label: String(s.year), weight: 1, num: true })),
        ],
        rows: Array.from({ length: n }, (_, i) => [
          monthName(data.series[0].buckets[i].key),
          ...data.series.map((s) => (s.buckets[i].future ? null : s.buckets[i].visits)),
        ]),
        footer: ['Total', ...data.series.map((s) => s.buckets.reduce((sum, b) => sum + b.visits, 0))],
      },
    ];
  } else {
    const n = data.buckets.length;
    chart = {
      kind: type === 'line' ? 'lines' : 'bars',
      title: heading,
      ...(type === 'line'
        ? {
            axis: data.buckets.map((b) => axisOf(b, n)),
            series: [{ name: 'Visits', points: data.buckets.map((b) => ({ label: bucketLabel(b), value: b.visits, future: b.future })) }],
          }
        : { items: data.buckets.map((b) => ({ label: bucketLabel(b), axis: axisOf(b, n), value: b.visits, future: b.future })) }),
    };
    tables = [
      {
        title: heading,
        columns: [
          { label: rowLabel, weight: 3 },
          { label: 'Total Visits', weight: 1, num: true },
        ],
        rows: data.buckets.map((b) => [bucketLabel(b), b.future ? null : b.visits]),
        footer: ['Total', data.total],
      },
    ];
  }

  return {
    id: 'trends',
    title: 'Library Visit Trends',
    description:
      'How library usage changes over time, as daily, monthly or yearly visit counts, or a comparison of years. A student counts once per day.',
    period,
    filters,
    summary: `${visitsText(data.total)} in total`,
    notes: [],
    charts: data.total > 0 ? [chart] : [],
    emptyText: data.total > 0 ? null : 'No visits were recorded for this selection.',
    tables,
    audit: `${TREND_LABELS[report]}, ${period}`,
  };
}

// ---- Peak Library Usage ----

const GROUP_LABELS = { hour: 'By hour', weekday: 'By day of week', month: 'By month' };

async function peakSection(opts) {
  const data = await peakData(opts.query);
  const group = opts.group;

  let view;
  if (group === 'hour') {
    view = {
      title: 'Visits by hour',
      column: 'Hour',
      rows: data.byHour.map((h) => ({ label: hourRange(h.hour), axis: hourShort(h.hour), visits: h.visits })),
    };
  } else if (group === 'weekday') {
    view = {
      title: 'Visits by day of the week',
      column: 'Day of the week',
      rows: data.byWeekday.map((d) => ({ label: weekdayLong(d.day), axis: weekdayShort(d.day), visits: d.visits, closed: d.closed })),
    };
  } else {
    const many = data.byMonth.length > 12;
    view = {
      title: 'Visits by month',
      column: 'Month',
      rows: data.byMonth.map((m) => ({
        label: monthYear(m.month),
        axis: monthShort(m.month) + (many ? ` ${m.month.slice(2, 4)}` : ''),
        visits: m.visits,
      })),
    };
  }

  const period = `${dayMedium(data.from)} to ${dayMedium(data.to)}`;
  const ins = data.insights;
  const insight = (label, item, name) => [label, item ? name(item) : '-', item ? item.visits : null];
  const closedNames = data.hours.closedWeekdays.map((d) => weekdayLong(d));

  const notes = [
    `Library hours: ${hourText(data.hours.open)} to ${hourText(data.hours.close)}${
      closedNames.length ? `, closed ${closedNames.join(' and ')}` : ''
    }. Only visits during these times are counted${
      data.offHours > 0 ? `; ${visitsText(data.offHours)} outside them ${data.offHours === 1 ? 'is' : 'are'} left out` : ''
    }.`,
    'Each student counts once per day, at the time they first arrived.',
  ];

  return {
    id: 'peak',
    title: 'Peak Library Usage',
    description: 'When the library is busiest: the busiest hours, days and months in the selected period.',
    period,
    filters: [
      ['Period', `${SUMMARY_RANGE_LABELS[opts.query.range]} (${period})`],
      ['Group visits', GROUP_LABELS[group]],
    ],
    summary: `${visitsText(data.counted)} from ${period}`,
    notes,
    charts: data.counted > 0 ? [{ kind: 'bars', title: view.title, items: view.rows.map((r) => ({ label: r.label, axis: r.axis, value: r.visits, closed: r.closed })) }] : [],
    emptyText: data.counted > 0 ? null : 'No visits during library hours in this period.',
    tables: [
      {
        title: 'Busiest and quietest times',
        columns: [
          { label: 'Measure', weight: 2.2 },
          { label: 'When', weight: 2.2 },
          { label: 'Visits', weight: 1, num: true },
        ],
        rows: [
          insight('Busiest day of the week', ins.busiestDay, (i) => weekdayLong(i.day)),
          insight('Busiest month', ins.busiestMonth, (i) => monthYear(i.month)),
          insight('Busiest hour', ins.busiestHour, (i) => hourRange(i.hour)),
          insight('Least busy day', ins.leastBusyDay, (i) => weekdayLong(i.day)),
          insight('Least busy hour', ins.leastBusyHour, (i) => hourRange(i.hour)),
        ],
      },
      {
        title: view.title,
        columns: [
          { label: view.column, weight: 3 },
          { label: 'Total Visits', weight: 1, num: true },
        ],
        rows: view.rows.map((r) => [r.label, r.closed ? 'Closed' : r.visits]),
        footer: ['Total', data.counted],
      },
    ],
    audit: `${SUMMARY_RANGE_LABELS[opts.query.range]} (${period}), ${GROUP_LABELS[group].toLowerCase()}`,
  };
}

// ---- Library Visits by Academic Program and Year Level ----

function summarizeRows(rows) {
  const programs = new Map();
  const years = new Map();
  for (const r of rows) {
    const p = programs.get(r.program) || { program: r.program, total: 0, byYear: new Map() };
    p.total += r.visits;
    p.byYear.set(r.yearLevel, (p.byYear.get(r.yearLevel) || 0) + r.visits);
    programs.set(r.program, p);
    years.set(r.yearLevel, (years.get(r.yearLevel) || 0) + r.visits);
  }
  return {
    programs: [...programs.values()].sort((a, b) => b.total - a.total || a.program.localeCompare(b.program)),
    years: [...years.entries()].map(([level, visits]) => ({ level, visits })).sort((a, b) => (a.level ?? 99) - (b.level ?? 99)),
  };
}

const MAX_LISTED = 400; // characters of a long list of program names shown in the filters box
function listNames(names) {
  const text = names.join('; ');
  return text.length <= MAX_LISTED ? text : `${text.slice(0, MAX_LISTED).replace(/;[^;]*$/, '')}; and more`;
}

async function programsSection(opts) {
  const data = await programYearData(opts.query);
  const sel = opts.selection;

  // Only the chosen programs and year levels are kept, and every percentage
  // below is worked out over what is left.
  let rows = data.rows;
  if (sel?.programs) rows = rows.filter((r) => sel.programs.has(r.program));
  if (sel?.yearLevels) rows = rows.filter((r) => sel.yearLevels.has(r.yearLevel));
  if (sel && data.rows.length > 0 && rows.length === 0) {
    throw httpError(400, 'None of the chosen programs and year levels have visits in this period.');
  }

  const view = summarizeRows(rows);
  const total = rows.reduce((n, r) => n + r.visits, 0);
  const allPrograms = summarizeRows(data.rows).programs.map((p) => p.program).sort((a, b) => a.localeCompare(b));
  const allLevels = [...new Set(data.rows.map((r) => r.yearLevel))].sort((a, b) => (a ?? 99) - (b ?? 99));
  const levels = view.years.map((y) => y.level);
  const levelKey = (l) => String(l ?? 'none');

  const chosenPrograms = view.programs.map((p) => p.program).sort((a, b) => a.localeCompare(b));
  const everyProgram = !sel?.programs || chosenPrograms.length === allPrograms.length;
  const everyLevel = !sel?.yearLevels || levels.length === allLevels.length;
  const screenYear = data.yearLevel ? yearLabel(data.yearLevel) : 'All year levels';
  const yearText = data.yearLevel ? screenYear : everyLevel ? 'All year levels' : levels.map(yearLabel).join(', ');
  const period = `${dayMedium(data.from)} to ${dayMedium(data.to)}`;

  const filters = [
    ['Period', `${PROGRAM_RANGE_LABELS[opts.query.range]} (${period})`],
    ['Year level filter', screenYear],
    [
      'Academic programs',
      everyProgram ? `All programs (${chosenPrograms.length})` : `${chosenPrograms.length} of ${allPrograms.length} selected: ${listNames(chosenPrograms)}`,
    ],
    [
      'Year levels',
      everyLevel ? 'All year levels' : `${levels.length} of ${allLevels.length} selected: ${levels.map(yearLabel).join(', ')}`,
    ],
  ];

  const notes = [];
  if (data.leftOut > 0 && !data.yearLevel) {
    notes.push(`${visitsText(data.leftOut)} by accounts without a program, such as staff, ${data.leftOut === 1 ? 'is' : 'are'} not counted here.`);
  }
  if (!everyProgram || !everyLevel) notes.push('Percentages are worked out over the chosen programs and year levels only.');

  const charts = [];
  if (total > 0) {
    charts.push({
      kind: 'hbars',
      title: 'Comparison of visits among programs',
      items: view.programs.map((p) => ({ label: p.program, value: p.total, share: percent(p.total, total) })),
    });
    charts.push({
      kind: 'stacked',
      title: 'Program usage across year levels',
      levels: levels.map((l) => ({ key: levelKey(l), label: yearLabel(l), level: l })),
      items: view.programs.map((p) => ({
        label: p.program,
        total: p.total,
        parts: Object.fromEntries(levels.map((l) => [levelKey(l), p.byYear.get(l) || 0])),
      })),
    });
    charts.push({
      kind: 'hbars',
      title: 'Total visits per year level',
      items: view.years.map((y) => ({ label: yearLabel(y.level), value: y.visits, share: percent(y.visits, total) })),
    });
  }

  const tables = [];
  if (total > 0) {
    tables.push(
      {
        title: 'Visits per academic program',
        columns: [
          { label: 'Academic Program', weight: 4 },
          { label: 'Year Level', weight: 2.2 },
          { label: 'Total Visits', weight: 1.2, num: true },
          { label: '% of Visits', weight: 1.2, num: true },
        ],
        rows: view.programs.map((p) => [p.program, yearText, p.total, percent(p.total, total)]),
        footer: ['Total', '', total, percent(total, total)],
      },
      {
        title: 'Visits per program and year level',
        columns: [
          { label: 'Academic Program', weight: 4 },
          ...levels.map((l) => ({ label: yearLabel(l), weight: 1.3, num: true })),
          { label: 'Total', weight: 1.2, num: true },
        ],
        rows: view.programs.map((p) => [p.program, ...levels.map((l) => p.byYear.get(l) || 0), p.total]),
        footer: ['Total', ...levels.map((l) => view.years.find((y) => y.level === l).visits), total],
      },
      {
        title: 'Visits per year level',
        columns: [
          { label: 'Year Level', weight: 3 },
          { label: 'Total Visits', weight: 1.2, num: true },
          { label: '% of Visits', weight: 1.2, num: true },
        ],
        rows: view.years.map((y) => [yearLabel(y.level), y.visits, percent(y.visits, total)]),
        footer: ['Total', total, percent(total, total)],
      }
    );
  }

  const selectionAudit =
    everyProgram && everyLevel ? 'all programs and year levels' : `${chosenPrograms.length} of ${allPrograms.length} programs, ${levels.length} of ${allLevels.length} year levels`;

  return {
    id: 'programs',
    title: 'Library Visits by Academic Program and Year Level',
    description:
      'Which programs and year levels account for the recorded visits. Each student counts once per day, using the program and year level on their student record.',
    period,
    filters,
    summary: `${visitsText(total)} from ${period} (${yearText})`,
    notes,
    charts,
    emptyText:
      total > 0
        ? null
        : data.yearLevel
          ? `No visits by ${screenYear} students were recorded in this period.`
          : 'No visits by students with a recorded program were found in this period.',
    tables,
    audit: `${PROGRAM_RANGE_LABELS[opts.query.range]} (${period}), ${selectionAudit}`,
  };
}

const BUILDERS = { summary: summarySection, trends: trendsSection, peak: peakSection, programs: programsSection };

// Every section lists its period first, once.
function finish(section) {
  if (!section.filters.some(([label]) => label === 'Period')) section.filters.unshift(['Period', section.period]);
  return section;
}

// One section for a single chart, or all four (each with its default options) for the combined report.
export async function buildSections(parsed) {
  if (parsed.chart === 'all') {
    const sections = [];
    for (const id of ['summary', 'trends', 'peak', 'programs']) {
      sections.push(finish(await BUILDERS[id](DEFAULT_OPTIONS[id])));
    }
    return sections;
  }
  return [finish(await BUILDERS[parsed.chart](parsed.options))];
}
