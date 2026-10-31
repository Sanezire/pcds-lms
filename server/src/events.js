import { Router } from 'express';
import { ATTENDANCE_ROLES } from './config.js';
import { requireAuth, requireRole, httpError } from './middleware/auth.js';
import { requireKioskKey } from './middleware/kioskKey.js';

// Live updates. Signed-in staff screens keep one Server-Sent Events connection
// open; whenever data changes, the server announces which topic changed and
// each screen reloads just that data. Topics:
//   attendance  RFID taps and manual entries (Statistics, Manual attendance)
//   messages    ID messages (Message Configuration)
const clients = new Set();
const HEARTBEAT_MS = 25 * 1000;

export function publish(topic) {
  const frame = `event: change\ndata: ${JSON.stringify({ topic, at: Date.now() })}\n\n`;
  for (const res of clients) res.write(frame);
}

function openStream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write(`event: ready\ndata: {}\n\n`);

  clients.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

// Signed-in staff screens.
const router = Router();
router.use(requireAuth, requireRole(...ATTENDANCE_ROLES));
router.get('/', openStream);

// The kiosk screen, which has no sign-in. Frames only name the topic that
// changed, never any data. The number of open streams is capped so strangers
// cannot hold connections open.
const MAX_KIOSK_STREAMS = 20;
let kioskStreams = 0;
export const kioskStreamRouter = Router();
kioskStreamRouter.get('/', requireKioskKey, (req, res, next) => {
  if (kioskStreams >= MAX_KIOSK_STREAMS) return next(httpError(503, 'Too many open screens.'));
  kioskStreams += 1;
  res.once('close', () => {
    kioskStreams -= 1;
  });
  openStream(req, res);
});

export function closeAllClients() {
  for (const res of clients) res.end();
  clients.clear();
}

export default router;
