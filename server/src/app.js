require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');

const { initDatabase } = require('./models/init-db');
const { runMigrations } = require('./models/migrator');
const { getDb } = require('./models/db');
const { setupSocket } = require('./services/socket');
const { startDashscopeTTSOnServer } = require('./services/dashscope-tts');
const { startDashscopeASROnServer } = require('./services/dashscope-asr');
const { startVoicePipelineOnServer } = require('./services/voice-pipeline');
// v1.007: silence-monitor merged into guardian-service
const { startGuardianService } = require('./services/guardian/guardian-service');
const { startScheduler } = require('./services/scheduler');

// Route imports
const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/session');
const messageRoutes = require('./routes/message');
const warningRoutes = require('./routes/warning');
const studentRoutes = require('./routes/student');
const aiRoutes = require('./routes/ai');
const dashboardRoutes = require('./routes/dashboard');
const summaryRoutes = require('./routes/summary');
const voiceRoutes = require('./routes/voice');

// Initialize database (create tables if first run)
initDatabase();
// Run pending migrations (schema updates for existing databases)
runMigrations(getDb());

// Create Express app
const app = express();
const server = http.createServer(app);

// Socket.io setup - don't attach to specific server yet, will attach to both HTTP and HTTPS
const io = new Server({
  cors: {
    origin: true,  // Allow all origins (same-origin in production, dev ports in development)
    methods: ['GET', 'POST'],
    credentials: true
  }
});
io.attach(server);

// Store io instance on app for access in routes
app.set('io', io);

// Setup WebSocket
setupSocket(io);

// Middleware
app.use(cors({
  origin: true,  // Allow all origins (same-origin in production, dev ports in development)
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static file serving for uploads
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/uploads')) {
      console.log(`[${req.method}] ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/message', messageRoutes);
app.use('/api/warning', warningRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/voice', voiceRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve frontend static files (built with `npm run build` in parent dir)
const distPath = path.resolve(__dirname, '../../dist');
app.use(express.static(distPath, {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

// SPA fallback: non-API routes serve index.html for client-side routing
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ code: -1, message: 'API endpoint not found', data: null });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ code: -1, message: 'Internal server error', data: null });
});

// Start server
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`  Psychology Counseling Platform Server`);
  console.log(`  HTTP:       http://${HOST}:${PORT}`);
  console.log(`  WebSocket:  ws://${HOST}:${PORT}`);

  // v1.008: DashScope ASR/TTS + Agent voice pipeline
  startDashscopeTTSOnServer(server);

  startDashscopeASROnServer(server);

  // v1.007: Voice pipeline (ASR → Agent → TTS full loop)
  startVoicePipelineOnServer(server, io);

  // v1.005: Start proactive AI services
  // v1.007: Guardian service (Kairos-inspired background daemon)
  startGuardianService(io);
  startScheduler(io);

  // Start HTTPS server using shared certificate (same cert as Vite dev server)
  try {
    const fs = require('fs');
    const sslDir = path.resolve(__dirname, '../ssl');
    const httpsServer = https.createServer({
      key: fs.readFileSync(path.join(sslDir, 'key.pem')),
      cert: fs.readFileSync(path.join(sslDir, 'cert.pem')),
    }, app);

    // Mount Socket.io + v1.008 voice pipeline on HTTPS server too
    io.attach(httpsServer);
    startDashscopeTTSOnServer(httpsServer);
    startDashscopeASROnServer(httpsServer);
    startVoicePipelineOnServer(httpsServer, io);

    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`  HTTPS/WSS:  https://${HOST}:${HTTPS_PORT} (self-signed, for mobile)`);
      console.log('='.repeat(50));
    });
  } catch (e) {
    console.log(`  HTTPS:      unavailable (npm install node-forge to enable)`);
    console.log('='.repeat(50));
  }

  console.log('');
  console.log('Test accounts:');
  console.log('  Teacher: T001 / teacher123');
  console.log('  Student: S20240001 / student123');
  console.log('  Student: S20240002 / student123');
  console.log('  Student: S20240003 / student123');
  console.log('');
});

module.exports = { app, server, io };
