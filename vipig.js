/*
 * VIPIG AUTOMATION LOGIC v11.0 (vipig.js)
 * UPGRADE: Thêm logic xử lý lỗi rate-limit của Instagram, tự động cooldown.
 * Xử lý lỗi cookie và tự động chuyển đổi.
 * Tích hợp callback để cập nhật UI real-time.
 */
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';
const delay = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const igAccountsCooldown = new Map();

async function igAction(log, type, targetId, igCookie) {
    const csrfTokenMatch = igCookie.match(/csrftoken=([^;]+)/);
    if (!csrfTokenMatch) {
        log('Cookie Instagram thiếu "csrftoken".', 'error');
        return { success: false, error: 'Invalid Cookie' };
    }
    const csrfToken = csrfTokenMatch[1];
    const headers = {
        'Cookie': igCookie, 'User-Agent': USER_AGENT,
        'X-Csrftoken': csrfToken, 'X-Ig-App-Id': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.instagram.com/'
    };
    
    let endpoint = '';
    let data = {};

    if (type === 'like') {
        endpoint = `https://www.instagram.com/api/v1/web/likes/${targetId}/like/`;
    } else if (type === 'follow') {
        endpoint = `https://www.instagram.com/api/v1/friendships/create/${targetId}/`;
        data = new URLSearchParams({ user_id: targetId });
    }

    try {
        const response = await axios.post(endpoint, data, { headers });
        if (response.data.status === 'ok') {
            return { success: true, error: null };
        }
        return { success: false, error: response.data.message || 'Unknown error' };
    } catch (error) {
        const errorMessage = error.response?.data?.message || error.message;
        log(`Lỗi IG ${type}: ${errorMessage}`, 'error');
        return { success: false, error: errorMessage };
    }
}

async function login(state, log, username, password) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar }));
    log(`Đang đăng nhập vào VipIG: ${username}`);
    try {
        const res = await client.post('https://vipig.net/login.php', new URLSearchParams({ username, password, submit: 'ĐĂNG NHẬP' }), { headers: { 'User-Agent': USER_AGENT } });
        if (res.data.includes('id="soduchinh"')) {
            log('Đăng nhập VipIG thành công!', 'success');
            const coinMatch = res.data.match(/id="soduchinh">(.+?)<\/span>/);
            if (coinMatch) state.stats.coin = coinMatch[1];
            state.stats.user = username;
            state.vipigSession = client;
            return true;
        }
        log('Sai tài khoản hoặc mật khẩu VipIG!', 'error');
        return false;
    } catch (error) {
        log(`Lỗi API đăng nhập VipIG: ${error.message}`, 'error');
        return false;
    }
}

async function getIgInfo(log, cookie) {
    try {
        const res = await axios.get('https://www.instagram.com/api/v1/accounts/edit/web_form_data/', { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT, 'X-Ig-App-Id': '1217981644879628' } });
        if (res.data && res.data.form_data) {
            const userIdMatch = cookie.match(/ds_user_id=([^;]+)/);
            if (userIdMatch) {
                return { username: res.data.form_data.username, userId: userIdMatch[1], cookie };
            }
        }
    } catch (e) { log(`Cookie không hợp lệ hoặc đã hết hạn.`, 'warning'); }
    return null;
}

async function setInstagramAccount(state, log, igUserId) {
    if (!state.vipigSession) return false;
    log(`Đang đặt cấu hình IG ID: ${igUserId}`);
    try {
        const response = await state.vipigSession.post('https://vipig.net/cauhinh/datnick.php', new URLSearchParams({ 'iddat[]': igUserId }), { headers: { 'User-Agent': USER_AGENT, 'X-Requested-With': 'XMLHttpRequest' } });
        if (response.data && response.data.toString().trim() === '1') {
            log('Đặt cấu hình Instagram thành công!', 'success');
            return true;
        }
        log(`Lỗi đặt cấu hình IG. Phản hồi: ${response.data}`, 'error');
        return false;
    } catch (error) {
        log(`Lỗi API đặt cấu hình IG: ${error.message}`, 'error');
        return false;
    }
}

async function getVipigJobs(state, log, jobType) {
    const endpoint = jobType === 'instagram_like' ? 'kiemtien' : 'kiemtien/subcheo';
    try {
        const res = await state.vipigSession.get(`https://vipig.net/${endpoint}/getpost.php`, { headers: { 'User-Agent': USER_AGENT, 'X-Requested-With': 'XMLHttpRequest' } });
        return res.data || [];
    } catch (e) { log(`Lỗi lấy nhiệm vụ ${jobType}: ${e.message}`, 'error'); return []; }
}

async function claimVipig(state, log, jobType, jobId, sendUpdate) {
    let endpoint = '', data = new URLSearchParams({ id: jobId });
    if (jobType === 'instagram_like') endpoint = 'kiemtien/nhantien.php';
    else endpoint = 'kiemtien/subcheo/nhantien2.php';
    try {
        const res = await state.vipigSession.post(`https://vipig.net/${endpoint}`, data, { headers: { 'User-Agent': USER_AGENT, 'X-Requested-With': 'XMLHttpRequest', 'Origin': 'https://vipig.net' } });
        if (res.data.mess) {
            log(`${res.data.mess}`, 'success');
            state.stats.jobsDone++;
            const coinMatch = res.data.mess.match(/(\d{1,3}(?:[.,]\d{3})*)\s*xu/);
            if (coinMatch) state.stats.coin = parseInt(coinMatch[1].replace(/[.,]/g, '')).toLocaleString('vi-VN');
            sendUpdate();
        } else if (res.data.error) { log(`Lỗi nhận thưởng: ${res.data.error}`, 'error'); }
    } catch (e) { log(`Lỗi API nhận thưởng: ${e.message}`, 'error'); }
}

async function runAutomation(state, log, updateStatus, sendUpdate) {
    if (!state.isRunning) { updateStatus('Đã dừng', 'var(--danger)'); return; }
    const config = state.config;
    
    updateStatus('Xác thực Cookies IG...', 'var(--accent-vipig)');
    let validIgCookies = [];
    for (const cookie of config.instagramCookies) {
        const info = await getIgInfo(log, cookie);
        if (info) {
            validIgCookies.push(info);
            log(`Cookie hợp lệ: ${info.username}`, 'success');
        }
    }
    if (validIgCookies.length === 0) {
        log('Không có cookie Instagram hợp lệ nào. Dừng auto.', 'error');
        stop(state, log, updateStatus);
        return;
    }

    try {
        while(state.isRunning) {
            for (const igAccount of validIgCookies) {
                if (!state.isRunning) break;

                const cooldownUntil = igAccountsCooldown.get(igAccount.userId);
                if (cooldownUntil && Date.now() < cooldownUntil) {
                    log(`Tài khoản ${igAccount.username} đang bị cooldown, bỏ qua.`, 'warning');
                    continue;
                }

                updateStatus(`Chuyển sang IG: ${igAccount.username}`, 'var(--accent-vipig)');
                state.stats.currentIg = igAccount.username;
                if (!await setInstagramAccount(state, log, igAccount.userId)) { continue; }

                let jobsThisRun = 0;
                let failsThisRun = 0;
                while (jobsThisRun < config.changeAfter && failsThisRun < 5 && state.isRunning) {
                    const jobType = config.jobTypes[Math.floor(Math.random() * config.jobTypes.length)];
                    updateStatus(`Lấy NV ${jobType.split('_')[1]}`, 'var(--accent-vipig)');
                    const jobs = await getVipigJobs(state, log, jobType);
                    if (!jobs || jobs.length === 0) { log(`Hết nhiệm vụ ${jobType}`, 'info'); break; }

                    for (const job of jobs) {
                        if (!state.isRunning || jobsThisRun >= config.changeAfter || failsThisRun >= 5) break;
                        
                        const action = jobType === 'instagram_like' ? 'like' : 'follow';
                        const targetId = action === 'like' ? job.mediaid : job.soID;
                        const postId = action === 'like' ? job.idpost : job.soID;

                        updateStatus(`${action}: ${targetId.slice(0, 10)}...`, 'var(--accent-vipig)');
                        const result = await igAction(log, action, targetId, igAccount.cookie);

                        if (result.success) {
                            await claimVipig(state, log, jobType, postId, sendUpdate);
                            jobsThisRun++;
                        } else {
                            failsThisRun++;
                            if (result.error && result.error.includes('Please wait a few minutes')) {
                                log(`IG rate limit! Tạm nghỉ tài khoản ${igAccount.username} trong 10 phút.`, 'error');
                                igAccountsCooldown.set(igAccount.userId, Date.now() + 10 * 60 * 1000);
                                break;
                            }
                             if (result.error && result.error.includes('Maximum number of redirects')) {
                                log(`Cookie ${igAccount.username} có vẻ đã hết hạn.`, 'error');
                                failsThisRun = 99;
                                break;
                            }
                        }
                        await delay(config.delay);
                    }
                }
            }
            if(state.isRunning) {
                log('Hoàn thành tất cả tài khoản. Bắt đầu lại sau 60 giây.', 'info');
                await delay(60);
            }
        }
    } catch (e) { log(`Lỗi vòng lặp VipIG: ${e.message}`, 'error'); }
    
    stop(state, log, updateStatus);
}

function stop(state, log, updateStatus) {
    state.isRunning = false;
    if (state.timeoutId) {
        clearTimeout(state.timeoutId);
        state.timeoutId = null;
    }
    log('Đã nhận lệnh dừng.', 'info');
    updateStatus('Đã dừng', 'var(--danger)');
}

module.exports = { login, runAutomation, stop };
