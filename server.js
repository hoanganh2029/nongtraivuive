/*
 * ALL-IN-ONE HUB v11.0 - MAIN SERVER (server.js)
 * UPGRADE: Tích hợp Server-Sent Events (SSE) để cập nhật UI real-time.
 * Cấu trúc lại để truyền SSE client cho các module xử lý.
 */
const express = require('express');
const path = require('path');
const VIPIG_MODULE = require('./vipig.js');
const TTC_MODULE = require('./ttc.js');

const app = express();
const PORT = process.env.PORT || 3000;

let sseClients = []; // Store connected clients for Server-Sent Events

// --- MASTER STATE ---
let masterState = {
    vipig: { isRunning: false, logs: [], stats: { user: 'N/A', coin: 'N/A', jobsDone: 0, status: 'Dừng', statusColor: 'var(--danger)', currentIg: 'N/A' }, config: {}, vipigSession: null, timeoutId: null },
    ttc: { isRunning: false, logs: [], stats: { user: 'N/A', coin: 'N/A', jobsDone: 0, status: 'Dừng', statusColor: 'var(--danger)', currentFb: 'N/A' }, config: { jobTypes: ['subcheo', 'likepostvipre', 'cmtcheo', 'likepagecheo', 'likepostvipcheo', 'sharecheo'] }, ttcSession: null, timeoutId: null }
};

// --- MIDDLEWARE & HELPERS ---
app.use(express.json());

const sendUpdateToClients = () => {
    const safeState = {
        vipig: { isRunning: masterState.vipig.isRunning, stats: masterState.vipig.stats },
        ttc: { isRunning: masterState.ttc.isRunning, stats: masterState.ttc.stats }
    };
    sseClients.forEach(client => client.res.write(`data: ${JSON.stringify(safeState)}\n\n`));
};

const log = (service, message, type = 'info') => {
    const timeString = new Date().toLocaleTimeString('vi-VN');
    const logEntry = { service, time: `[${timeString}]`, message, type };
    console.log(`[${service.toUpperCase()}] ${timeString} [${type.toUpperCase()}] ${message}`);
    
    sseClients.forEach(client => client.res.write(`event: new_log\ndata: ${JSON.stringify(logEntry)}\n\n`));
};

const updateStatus = (service, status, color = 'var(--text-primary)') => {
    if (masterState[service]) {
        masterState[service].stats.status = status;
        masterState[service].stats.statusColor = color;
        sendUpdateToClients();
    }
};

// --- API & SSE ENDPOINTS ---
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);
    
    sendUpdateToClients();

    req.on('close', () => {
        sseClients = sseClients.filter(client => client.id !== clientId);
    });
});

// VIPIG Endpoints
app.post('/api/vipig/login', async (req, res) => {
    const success = await VIPIG_MODULE.login(masterState.vipig, (m,t) => log('vipig',m,t), req.body.vipigUser, req.body.vipigPass);
    if(success) sendUpdateToClients();
    res.status(success ? 200 : 401).json({ message: success ? 'Đăng nhập VipIG thành công!' : 'Đăng nhập VipIG thất bại.' });
});

app.post('/api/vipig/start', (req, res) => {
    if (masterState.vipig.isRunning) return res.status(400).json({ message: 'VipIG đã đang chạy.' });
    if (!masterState.vipig.vipigSession) return res.status(400).json({ message: 'Vui lòng đăng nhập VipIG trước.' });

    const { instagramCookies, delay, changeAfter } = req.body;
    const igCookies = instagramCookies.split('\n').filter(c => c.trim() !== '');
    if (igCookies.length === 0) return res.status(400).json({ message: 'Vui lòng nhập Cookie Instagram.' });

    masterState.vipig.config = { instagramCookies: igCookies, delay: parseInt(delay), changeAfter: parseInt(changeAfter), jobTypes: ['instagram_follow', 'instagram_like'] };
    masterState.vipig.isRunning = true;
    masterState.vipig.stats.jobsDone = 0;
    
    VIPIG_MODULE.runAutomation(masterState.vipig, (m,t) => log('vipig',m,t), (s,c) => updateStatus('vipig',s,c), sendUpdateToClients);
    res.json({ message: 'Bắt đầu VipIG thành công!' });
});

app.post('/api/vipig/stop', (req, res) => {
    VIPIG_MODULE.stop(masterState.vipig, (m,t) => log('vipig',m,t), (s,c) => updateStatus('vipig',s,c));
    res.json({ message: 'Đã dừng VipIG!' });
});

// TTC Endpoints
app.post('/api/ttc/login', async (req, res) => {
    const success = await TTC_MODULE.login(masterState.ttc, (m,t) => log('ttc',m,t), req.body.ttcToken);
    if(success) sendUpdateToClients();
    res.status(success ? 200 : 401).json({ message: success ? 'Đăng nhập TTC thành công!' : 'Đăng nhập TTC thất bại.' });
});

app.post('/api/ttc/start', (req, res) => {
    if (masterState.ttc.isRunning) return res.status(400).json({ message: 'TTC đã đang chạy.' });
    if (!masterState.ttc.ttcSession) return res.status(400).json({ message: 'Vui lòng đăng nhập TTC trước.' });
    
    const { facebookTokens, delay, limitPerToken, failLimit } = req.body;
    const fbTokens = facebookTokens.split('\n').filter(t => t.trim() !== '');
    if (fbTokens.length === 0) return res.status(400).json({ message: 'Vui lòng nhập Token Facebook.' });

    masterState.ttc.config = { ...masterState.ttc.config, facebookTokens: fbTokens, delay: parseInt(delay), limitPerToken: parseInt(limitPerToken), failLimit: parseInt(failLimit) };
    masterState.ttc.isRunning = true;
    masterState.ttc.stats.jobsDone = 0;
    
    TTC_MODULE.runAutomation(masterState.ttc, (m,t) => log('ttc',m,t), (s,c) => updateStatus('ttc',s,c), sendUpdateToClients);
    res.json({ message: 'Bắt đầu TTC thành công!' });
});

app.post('/api/ttc/stop', (req, res) => {
    TTC_MODULE.stop(masterState.ttc, (m,t) => log('ttc',m,t), (s,c) => updateStatus('ttc',s,c));
    res.json({ message: 'Đã dừng TTC!' });
});

// --- SERVE FRONTEND ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'gop.html'));
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 All-in-One Hub v11.0 (Professional) đang chạy tại http://localhost:${PORT}`);
});
