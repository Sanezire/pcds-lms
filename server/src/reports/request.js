import { httpError } from '../middleware/auth.js';
import { ROLES } from '../config.js';

// Every option of an analytics export is checked here before any data is read.
// Anything that is not on a list below is rejected, so a request can only ask for
// what the Analytics screen itself can show.

export const CHART_IDS = ['summary', 'trends', 'peak', 'programs'];
const FORMATS = ['pdf', 'csv'];

const SUMMARY_RANGES = ['last7', 'last30', 'month', 'last90', 'year', 'custom'];
const PEAK_GROUPS = ['hour', 'weekday', 'month'];
const PROGRAM_RANGES = ['all', 'year', 'lastYear', 'last90', 'month', 'last30', 'custom'];
const TREND_REPORTS = ['daily', 'monthly', 'annual', 'compare', 'custom'];
const CHART_TYPES = ['line', 'bar'];

const MAX_PROGRAMS = 200;
const MAX_PROGRAM_LENGTH = 150;
const MAX_COMPARE_YEARS = 4;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const short = (v) => String(v).replace(/[^\w .-]/g, '').slice(0, 30);

function onlyKeys(obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw httpError(400, `Unknown export option: ${short(key)}.`);
  }
}

// A string or a number, as text. Objects, arrays and booleans are not accepted.
function scalar(value, label) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  throw httpError(400, `${label} is not valid.`);
}

function oneOf(value, list, label) {
  const text = scalar(value, label);
  if (!list.includes(text)) throw httpError(400, `${label} is not valid.`);
  return text;
}

function day(value, label) {
  const text = scalar(value, label);
  if (!DAY_RE.test(text)) throw httpError(400, `${label} is not a valid date.`);
  return text;
}

// range plus the two dates a custom range needs, and nothing else.
function rangeOptions(f, ranges, fallback) {
  const range = f.range === undefined ? fallback : oneOf(f.range, ranges, 'Period');
  const q = { range };
  if (range === 'custom') {
    if (f.from === undefined || f.to === undefined) throw httpError(400, 'Choose a start and end date.');
    q.from = day(f.from, 'Start date');
    q.to = day(f.to, 'End date');
  } else if (f.from !== undefined || f.to !== undefined) {
    throw httpError(400, 'Dates can only be used with a custom range.');
  }
  return q;
}

function parseSummary(f) {
  onlyKeys(f, ['range', 'from', 'to']);
  return { query: rangeOptions(f, SUMMARY_RANGES, 'last30') };
}

function parsePeak(f) {
  onlyKeys(f, ['range', 'from', 'to', 'group']);
  return {
    query: rangeOptions(f, SUMMARY_RANGES, 'last30'),
    group: f.group === undefined ? 'hour' : oneOf(f.group, PEAK_GROUPS, 'Grouping'),
  };
}

function parseTrends(f) {
  onlyKeys(f, ['report', 'month', 'year', 'years', 'from', 'to', 'chartType']);
  if (f.report === undefined) throw httpError(400, 'Choose a reporting period.');
  const report = oneOf(f.report, TREND_REPORTS, 'Reporting period');
  const allowedFor = {
    daily: ['report', 'month', 'chartType'],
    monthly: ['report', 'year', 'chartType'],
    annual: ['report', 'chartType'],
    compare: ['report', 'years', 'chartType'],
    custom: ['report', 'from', 'to', 'chartType'],
  };
  for (const key of Object.keys(f)) {
    if (!allowedFor[report].includes(key)) throw httpError(400, `${short(key)} does not apply to this report.`);
  }

  const q = { report };
  if (report === 'daily' && f.month !== undefined) {
    q.month = scalar(f.month, 'Month');
    if (!MONTH_RE.test(q.month)) throw httpError(400, 'Month is not valid.');
  }
  if (report === 'monthly' && f.year !== undefined) {
    q.year = scalar(f.year, 'Year');
    if (!YEAR_RE.test(q.year)) throw httpError(400, 'Year is not valid.');
  }
  if (report === 'compare') {
    if (!Array.isArray(f.years)) throw httpError(400, 'Choose at least two years to compare.');
    const years = [...new Set(f.years.map((y) => scalar(y, 'Year')))];
    if (years.some((y) => !YEAR_RE.test(y))) throw httpError(400, 'Year is not valid.');
    if (years.length < 2) throw httpError(400, 'Choose at least two years to compare.');
    if (years.length > MAX_COMPARE_YEARS) throw httpError(400, `Compare up to ${MAX_COMPARE_YEARS} years at a time.`);
    q.years = years.join(',');
  }
  if (report === 'custom') {
    if (f.from === undefined || f.to === undefined) throw httpError(400, 'Choose a start and end date.');
    q.from = day(f.from, 'Start date');
    q.to = day(f.to, 'End date');
  }
  return {
    query: q,
    chartType: f.chartType === undefined ? null : oneOf(f.chartType, CHART_TYPES, 'Chart type'),
  };
}

// The choice of programs and year levels. Only administrators and super admins
// may narrow the report; everyone else always gets the whole chart.
function parseSelection(f, user) {
  const hasPrograms = f.programs !== undefined;
  const hasLevels = f.yearLevels !== undefined;
  if (!hasPrograms && !hasLevels) return null;
  if (![ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(user?.role)) {
    throw httpError(403, 'Only administrators can choose which programs and year levels to print.');
  }

  let programs = null;
  if (hasPrograms) {
    if (!Array.isArray(f.programs) || f.programs.length === 0) throw httpError(400, 'Choose at least one academic program.');
    if (f.programs.length > MAX_PROGRAMS) throw httpError(400, 'Too many programs were chosen.');
    const names = f.programs.map((p) => {
      if (typeof p !== 'string') throw httpError(400, 'Program is not valid.');
      const name = p.trim();
      if (!name || name.length > MAX_PROGRAM_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
        throw httpError(400, 'Program is not valid.');
      }
      return name;
    });
    programs = new Set(names);
  }

  let yearLevels = null;
  if (hasLevels) {
    if (!Array.isArray(f.yearLevels) || f.yearLevels.length === 0) throw httpError(400, 'Choose at least one year level.');
    if (f.yearLevels.length > 7) throw httpError(400, 'Too many year levels were chosen.');
    // A year level is 1 to 6, or "none" for visits with no year level recorded.
    yearLevels = new Set(
      f.yearLevels.map((l) => {
        const text = scalar(l, 'Year level');
        if (text === 'none') return null;
        if (!/^[1-6]$/.test(text)) throw httpError(400, 'Year level is not valid.');
        return Number(text);
      })
    );
  }
  return { programs, yearLevels };
}

function parsePrograms(f, user) {
  onlyKeys(f, ['range', 'from', 'to', 'year', 'programs', 'yearLevels']);
  const q = rangeOptions(f, PROGRAM_RANGES, 'all');
  if (f.year !== undefined && f.year !== '') {
    q.year = scalar(f.year, 'Year level');
    if (!/^[1-6]$/.test(q.year)) throw httpError(400, 'Year level is not valid.');
  }
  return { query: q, selection: parseSelection(f, user) };
}

const PARSERS = { summary: parseSummary, trends: parseTrends, peak: parsePeak };

// Turns the request body into a plain, trusted description of the export.
export function parseExportRequest(body, user) {
  if (!isPlainObject(body)) throw httpError(400, 'Invalid export request.');
  onlyKeys(body, ['chart', 'format', 'filters']);

  const format = oneOf(body.format, FORMATS, 'Format');
  const chart = oneOf(body.chart, [...CHART_IDS, 'all'], 'Chart');
  const filters = body.filters === undefined ? {} : body.filters;
  if (!isPlainObject(filters)) throw httpError(400, 'Invalid export options.');

  if (chart === 'all') {
    if (format !== 'pdf') throw httpError(400, 'The combined report is only available as a PDF.');
    if (Object.keys(filters).length) throw httpError(400, 'The combined report uses each chart\'s default period and filters.');
    return { chart, format, options: null };
  }
  const options = chart === 'programs' ? parsePrograms(filters, user) : PARSERS[chart](filters);
  return { chart, format, options };
}

// What the combined report uses: the same defaults the Analytics screen opens with.
export const DEFAULT_OPTIONS = Object.freeze({
  summary: { query: { range: 'last30' } },
  trends: { query: { report: 'monthly' }, chartType: null },
  peak: { query: { range: 'last30' }, group: 'hour' },
  programs: { query: { range: 'all' }, selection: null },
});
