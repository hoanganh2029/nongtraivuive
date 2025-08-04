/*
 * TTC AUTOMATION LOGIC v11.0 (ttc.js)
 * UPGRADE: Tích hợp callback để cập nhật UI real-time.
 */
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const TTC_HEADERS = { "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest" };
const delay = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

async function login(state, log, token) {
    log(`Đang đăng nhập vào TTC...`);
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar }));
    try {
        const res = await client.post('https://tuongtaccheo.com/logintoken.php', new URLSearchParams({ 'access_token': token }));
        if (res.data.status === 'success') {
            log(`Đăng nhập TTC thành công: ${res.data.data.user}`, 'success');
            state.stats.user = res.data.data.user;
            state.stats.coin = Number(res.data.data.sodu).toLocaleString('vi-VN');
            state.ttcSession = client;
            return true;
        }
        log(`Login TTC thất bại: ${res.data.mess || 'Token không hợp lệ'}`, 'error');
        return false;
    } catch (e) { log(`Lỗi API đăng nhập TTC: ${e.message}`, 'error'); return false; }
}

async function getFacebookInfo(fbToken) {
    try { return (await axios.get(`https://graph.facebook.com/me?access_token=${fbToken}`)).data; } 
    catch (e) { return null; }
}

async function setFacebookAccount(state, log, fbUid) {
    try {
        const res = await state.ttcSession.post('https://tuongtaccheo.com/cauhinh/datnick.php', `iddat%5B%5D=${fbUid}&loai=fb`, { headers: { ...TTC_HEADERS, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } });
        if (res.data && res.data.toString().trim().includes('1')) {
             log(`Đặt cấu hình FB ID ${fbUid} thành công`, 'success');
            return true;
        }
        log(`Đặt cấu hình FB ID ${fbUid} thất bại. Phản hồi: ${res.data}`, 'warning');
        return false;
    } catch (e) { log(`Lỗi API đặt cấu hình: ${e.message}`, 'error'); return false; }
}

async function getTtcJobs(state, log, jobType) {
    try {
        const res = await state.ttcSession.get(`https://tuongtaccheo.com/kiemtien/${jobType}/getpost.php`, { headers: TTC_HEADERS });
        return res.data;
    } catch (e) { log(`Lỗi API lấy NV ${jobType}: ${e.message}`, 'error'); return []; }
}

async function claimTtcCoin(state, log, jobType, postId, sendUpdate) {
     try {
        const res = await state.ttcSession.post(`https://tuongtaccheo.com/kiemtien/${jobType}/nhantien.php`, new URLSearchParams({ id: postId }), { headers: TTC_HEADERS });
        if (res.data.mess) {
            const coinMatch = res.data.mess.match(/\+\s*([\d,.]+)\s*xu/);
             if (coinMatch) {
                const earned = parseInt(coinMatch[1].replace(/[.,]/g, ''));
                log(`+${earned.toLocaleString('vi-VN')} xu | ${res.data.mess}`, 'success');
                let currentCoin = parseInt(state.stats.coin.replace(/[.,]/g, '')) || 0;
                state.stats.coin = (currentCoin + earned).toLocaleString('vi-VN');
                state.stats.jobsDone++;
                sendUpdate();
             }
        } else if (res.data.error) { log(`Lỗi nhận xu: ${res.data.error}`, 'error'); }
    } catch (e) { log(`Lỗi API nhận xu: ${e.message}`, 'error'); }
}

async function fbAction(log, type, fbToken, id, msg = '') {
    const url = `https://graph.facebook.com`;
    let endpoint = '', params = { access_token: fbToken };
    switch(type) {
        case 'like': endpoint = `/${id}/likes`; break;
        case 'follow': endpoint = `/${id}/subscribers`; break;
        case 'comment': endpoint = `/${id}/comments`; params.message = msg; break;
        case 'share': endpoint = `/me/feed`; params.link = `https://www.facebook.com/${id}`; break;
        case 'pagelike': endpoint = `/${id}/likes`; break;
    }
    try { await axios.post(url + endpoint, new URLSearchParams(params)); return true; } 
    catch (e) { log(`Lỗi FB ${type}: ${e.response?.data?.error?.message || e.message}`, 'error'); return false; }
}

async function runAutomation(state, log, updateStatus, sendUpdate) {
    if (!state.isRunning) { updateStatus('Đã dừng', 'var(--danger)'); return; }
    let tokenIndex = 0;
    const config = state.config;
    while (state.isRunning) {
        if (tokenIndex >= config.facebookTokens.length) {
            tokenIndex = 0; log('Chạy hết token, quay lại từ đầu sau 30s.', 'info'); await delay(30);
            if(!state.isRunning) break;
        }
        const fbToken = config.facebookTokens[tokenIndex];
        updateStatus('Kiểm tra Token FB', 'var(--accent-ttc)');
        const fbInfo = await getFacebookInfo(fbToken);
        if (!fbInfo) { log(`Token FB thứ ${tokenIndex + 1} không hợp lệ.`, 'warning'); tokenIndex++; continue; }

        state.stats.currentFb = fbInfo.name;
        updateStatus(`Đặt cấu hình: ${fbInfo.name}`, 'var(--accent-ttc)');
        if (!await setFacebookAccount(state, log, fbInfo.id)) { tokenIndex++; continue; }
        
        let jobsThisToken = 0, failsThisToken = 0;
        for (const jobType of config.jobTypes) {
            if (!state.isRunning || jobsThisToken >= config.limitPerToken || failsThisToken >= config.failLimit) break;
            updateStatus(`Lấy NV ${jobType}`, 'var(--accent-ttc)');
            const jobs = await getTtcJobs(state, log, jobType);
            if (!jobs || !Array.isArray(jobs) || jobs.length === 0) { log(`Hết NV ${jobType}`, 'info'); continue; }
            log(`Tìm thấy ${jobs.length} NV ${jobType}`, 'success');

            for (const job of jobs) {
                if (!state.isRunning || jobsThisToken >= config.limitPerToken || failsThisToken >= config.failLimit) break;
                let actionType, targetId, msg = '', success = false;
                switch(jobType) {
                    case 'subcheo': actionType = 'follow'; targetId = job.idpost; break;
                    case 'likepostvipre': case 'likepostvipcheo': actionType = 'like'; targetId = job.idfb; break;
                    case 'likepagecheo': actionType = 'pagelike'; targetId = job.idpost; break;
                    case 'sharecheo': actionType = 'share'; targetId = job.idpost; break;
                    case 'cmtcheo': actionType = 'comment'; targetId = job.idpost; msg = JSON.parse(job.nd)[0]; break;
                }
                updateStatus(`${actionType}: ${targetId.slice(0,10)}...`, 'var(--accent-ttc)');
                success = await fbAction(log, actionType, fbToken, targetId, msg);
                if (success) {
                    failsThisToken = 0;
                    jobsThisToken++;
                    await claimTtcCoin(state, log, jobType, job.idpost, sendUpdate);
                } else {
                    failsThisToken++;
                    log(`Thất bại ${failsThisToken}/${config.failLimit} lần`, 'warning');
                }
                await delay(config.delay);
            }
        }
        log(`Hoàn thành phiên cho ${fbInfo.name}. Chuyển token...`, 'info'); tokenIndex++;
    }
    updateStatus('Đã dừng', 'var(--danger)');
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
