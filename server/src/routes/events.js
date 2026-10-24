import { Router } from 'express';
import { ROLES } from '../config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { subscribe } from '../events.js';

const router = Router();

// Server-sent events stream. It only carries the name of the topic that
// changed ("users", "attendance"), never any data. The browser then reloads
// that data through the normal authenticated API calls.
router.get('/', requireAuth, requireRole(ROLES.ADMIN, ROLES.LIBRARIAN), (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const unsubscribe = subscribe((topic) => {
    res.write(`event: refresh\ndata: ${topic}\n\n`);
  });

  // Keeps proxies and load balancers from closing an idle stream.
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
