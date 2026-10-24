import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { pool } from './db.js';
import { purgeExpiredSessions } from './sessions.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { requireCustomHeader } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import attendanceRoutes from './routes/attendance.js';
import eventRoutes from './routes/events.js';

const app = express();

app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
  })
);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', apiLimiter, requireCustomHeader);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/events', eventRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: { message: 'Not found.' } });
});

// Central error handler: known errors keep their status and message,
// anything unexpected is logged and returned as a generic 500.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: { message: 'Invalid request body.' } });
  }
  if (err.status) {
    return res.status(err.status).json({ error: { message: err.message, fields: err.fields } });
  }
  console.error(err);
  res.status(500).json({ error: { message: 'Something went wrong on our side. Try again.' } });
});

const server = app.listen(config.port, () => {
  console.log(`PCDS RFID Kiosk API listening on http://localhost:${config.port}`);
});

const cleanup = setInterval(() => {
  purgeExpiredSessions().catch((err) => console.error('Session cleanup failed:', err.message));
}, 60 * 60 * 1000);
cleanup.unref();

const shutdown = () => {
  server.close(() => pool.end().finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
