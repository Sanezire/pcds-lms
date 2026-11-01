import { Router } from 'express';
import { MANAGER_ROLES } from '../config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { reportLimiter } from '../middleware/rateLimit.js';
import { recordAudit } from '../audit.js';
import { parseExportRequest } from '../reports/request.js';
import { buildSections, generatedStamp, fileDate } from '../reports/analytics.js';
import { csvBody } from '../reports/csvWriter.js';
import { renderPdf } from '../reports/pdfWriter.js';

const router = Router();

// Same access as the Analytics screen itself: super admins, admins and librarians.
router.use(requireAuth, requireRole(...MANAGER_ROLES));

// POST /api/reports/analytics
//   { chart: 'summary' | 'trends' | 'peak' | 'programs' | 'all',
//     format: 'pdf' | 'csv',
//     filters: { ...what the chart currently has selected on screen } }
// Every option is validated first (see reports/request.js), the figures are
// read fresh from the attendance data, and each export is written to the audit log.
router.post('/analytics', reportLimiter, async (req, res, next) => {
  try {
    const parsed = parseExportRequest(req.body, req.user);
    const sections = await buildSections(parsed);
    const generated = generatedStamp();
    const base = `pcds-lrc-analytics-${parsed.chart}-${fileDate()}`;
    const format = parsed.format.toUpperCase();

    await recordAudit(
      req,
      'report.export',
      parsed.chart === 'all'
        ? `Exported all analytics as ${format} (${sections.length} charts)`
        : `Exported ${sections[0].title} as ${format}: ${sections[0].audit}`
    );

    res.set('Cache-Control', 'no-store');
    if (parsed.format === 'csv') {
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.csv"`,
      });
      return res.send(csvBody({ generated, sections }));
    }
    renderPdf(res, {
      title: parsed.chart === 'all' ? 'PCDS LRC Analytics Report: All Charts' : `PCDS LRC Analytics Report: ${sections[0].title}`,
      generated,
      sections,
      filename: `${base}.pdf`,
      multi: parsed.chart === 'all',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
