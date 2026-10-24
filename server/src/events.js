import { Router } from 'express';
import { ROLES } from './config.js';
import { requireAuth, requireRole } from './middleware/auth.js';

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

const router = Router();
router.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.LIBRARIAN));

router.get('/', (req, res) => {
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
});

export function closeAllClients() {
  for (const res of clients) res.end();
  clients.clear();
}

export default router;
