// shared.js — xX Trading Journal PWA utilities (Optimized)
import { supabase, getCurrentUser, hashPin, getCachedTrades, cacheTrades } from './db.js';

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

// ── Auth guard ────────────────────────────────────────────────────────────────
export async function requireAuth(redirectTo) {
    const user = await getCurrentUser();
    if (!user) {
        sessionStorage.setItem('xX_redirect', redirectTo || location.pathname);
        location.href = '/login.html';
        return null;
    }
    return user;
}

// ── Fast auth with immediate cache render ────────────────────────────────────
export async function requireAuthFast(redirectTo) {
    // Check session storage first (fastest)
    const cachedUser = sessionStorage.getItem('xX_cached_user');
    if (cachedUser) {
        try {
            const user = JSON.parse(cachedUser);
            // Fire background sync
            _bgSync();
            return user;
        } catch {}
    }

    const user = await getCurrentUser();
    if (!user) {
        sessionStorage.setItem('xX_redirect', redirectTo || location.pathname);
        location.href = '/login.html';
        return null;
    }

    // Cache user in session
    sessionStorage.setItem('xX_cached_user', JSON.stringify(user));
    
    // Fire background sync
    _bgSync();
    return user;
}

// ── PIN guard ─────────────────────────────────────────────────────────────────
export async function requirePin() {
    const pin      = localStorage.getItem('xX_app_pin');
    const unlocked = sessionStorage.getItem('xX_unlocked');
    if (pin && unlocked !== '1') {
        sessionStorage.setItem('xX_redirect', location.pathname);
        location.href = '/lock.html';
        return false;
    }
    return true;
}

// ── Toast (with queue) ─────────────────────────────────────────────────────
let toastQueue = [];
let toastVisible = false;

export function showToast(msg, type = 'info', duration = 2500) {
    const payload = { msg, type, duration };
    
    if (toastVisible) {
        toastQueue.push(payload);
        return;
    }
    
    toastVisible = true;
    _renderToast(payload);
}

function _renderToast({ msg, type, duration }) {
    let t = document.getElementById('__toast');
    if (!t) {
        t = document.createElement('div');
        t.id = '__toast';
        t.style.cssText = [
            'position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(8px)',
            'padding:10px 18px;border-radius:50px;font-weight:600;font-size:13px',
            'font-family:Inter,sans-serif;opacity:0;pointer-events:none;z-index:99999',
            'white-space:nowrap;transition:all 0.2s ease;border:1px solid;max-width:90%',
            'overflow:hidden;text-overflow:ellipsis'
        ].join(';');
        document.body.appendChild(t);
    }
    
    const cfg = {
        success: ['rgba(29,185,84,0.12)', 'rgba(29,185,84,0.35)', '#1DB954'],
        error:   ['rgba(226,33,52,0.12)', 'rgba(226,33,52,0.35)', '#E22134'],
        info:    ['rgba(74,144,226,0.12)', 'rgba(74,144,226,0.35)', '#4A90E2']
    };
    const [bg, bd, col] = cfg[type] || cfg.info;
    
    t.textContent = msg;
    t.style.background = bg;
    t.style.borderColor = bd;
    t.style.color = col;
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
    
    clearTimeout(t._tid);
    t._tid = setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(-50%) translateY(8px)';
        toastVisible = false;
        
        // Process queue
        if (toastQueue.length > 0) {
            const next = toastQueue.shift();
            setTimeout(() => _renderToast(next), 300);
        }
    }, duration);
}

// ── Bottom nav ────────────────────────────────────────────────────────────────
export function injectBottomNav(activePage) {
    if (document.getElementById('__bnav')) return;
    
    const nav = document.createElement('nav');
    nav.id = '__bnav';
    nav.style.cssText = [
        'position:fixed;bottom:0;left:0;right:0;background:#0a0a0a',
        'border-top:1px solid rgba(255,255,255,0.06)',
        'display:flex;justify-content:space-around;align-items:center',
        'padding:6px 0 max(6px,env(safe-area-inset-bottom));z-index:9000'
    ].join(';');

    const pages = [
        ['/', '🏠', 'HOME', 'home'],
        ['/journal.html', '📝', 'TRADE', 'journal'],
        ['/dashboard.html', '📊', 'DASH', 'dashboard'],
        ['/analytics.html', '📈', 'STATS', 'analytics'],
        ['/improvement.html', '🔧', 'IMPROVE', 'improvement'],
    ];

    nav.innerHTML = pages.map(([href, icon, label, key]) => {
        const active = key === activePage;
        return `<a href="${href}" style="
            display:flex;flex-direction:column;align-items:center;gap:1px;
            text-decoration:none;padding:4px 8px;border-radius:8px;
            color:${active ? '#fff' : 'rgba(255,255,255,0.3)'};
            transition:color 0.15s;
            -webkit-tap-highlight-color:transparent;
        ">
            <span style="font-size:20px;line-height:1.2">${icon}</span>
            <span style="font-size:8px;font-weight:${active ? 700 : 500};letter-spacing:0.6px">${label}</span>
        </a>`;
    }).join('');

    document.body.style.paddingBottom = '62px';
    document.body.appendChild(nav);
}

// ── Background sync (optimized) ──────────────────────────────────────────────
const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes

function _bgSync() {
    if (sessionStorage.getItem('xX_skip_sync') === '1') {
        sessionStorage.removeItem('xX_skip_sync');
        return;
    }
    
    const last = parseInt(sessionStorage.getItem('xX_last_sync') || '0');
    if (Date.now() - last < SYNC_INTERVAL) return;
    sessionStorage.setItem('xX_last_sync', String(Date.now()));

    // Use requestIdleCallback for non-critical sync
    const schedule = window.requestIdleCallback || window.setTimeout;
    schedule(async () => {
        try {
            const { loadAllTrades, saveCycles, getCurrentUser } = await import('./db.js');
            const user = await getCurrentUser();
            if (!user) return;

            const result = await loadAllTrades();
            if (!result?.journals) return;

            // Quick merge with localStorage
            const local = JSON.parse(localStorage.getItem('xX_journal_data') || '{}');
            const localJ = local.journals || {};
            const merged = result.journals;

            // Preserve screenshots from local if cloud doesn't have them
            for (const id of Object.keys(merged)) {
                const ct = merged[id], lt = localJ[id];
                if (!ct.screenshots?.length && lt?.screenshots?.length) {
                    ct.screenshots = lt.screenshots;
                }
            }

            // Save to localStorage
            localStorage.setItem('xX_journal_data', JSON.stringify({
                journals: merged,
                tradeCounter: result.tradeCounter || 1
            }));

            // Recalculate cycles from trades
            const sorted = Object.values(merged).sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
            const total = sorted.length;
            const done = Math.floor(total / 20);
            const inCur = total % 20;
            const cycles = {
                currentCycle: done + 1,
                tradesInCurrentCycle: inCur,
                completedCycles: Array.from({ length: done }, (_, i) => ({
                    cycleNumber: i + 1,
                    completedAt: sorted[(i + 1) * 20 - 1]?.timestamp || new Date().toISOString()
                })),
                allTrades: sorted.map(t => t.tradeId)
            };
            localStorage.setItem('xX_cycle_data', JSON.stringify(cycles));
            saveCycles(cycles).catch(() => {});
        } catch (e) {
            console.warn('[bgSync]', e);
        }
    });
}

// ── Manual sync ───────────────────────────────────────────────────────────────
export async function syncToLocalStorage() {
    sessionStorage.removeItem('xX_last_sync');
    _bgSync();
    // Also force a full sync
    try {
        const { loadAllTrades, getCurrentUser } = await import('./db.js');
        const user = await getCurrentUser();
        if (user) {
            const result = await loadAllTrades(true);
            if (result?.journals) {
                localStorage.setItem('xX_journal_data', JSON.stringify({
                    journals: result.journals,
                    tradeCounter: result.tradeCounter || 1
                }));
            }
        }
        showToast('Synced ✓', 'success');
    } catch (e) {
        showToast('Sync failed', 'error');
    }
}

// ── Download helper ───────────────────────────────────────────────────────────
export function downloadFile(content, filename, mimeType) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
    a.download = filename;
    a.click();
}

// ── Skeleton loading ──────────────────────────────────────────────────────────
export function showSkeleton(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
        <div style="animation:pulse 1.5s ease-in-out infinite;opacity:0.4">
            <div style="height:40px;background:rgba(255,255,255,0.06);border-radius:8px;margin-bottom:8px;"></div>
            <div style="height:20px;background:rgba(255,255,255,0.04);border-radius:6px;margin-bottom:6px;width:70%;"></div>
            <div style="height:20px;background:rgba(255,255,255,0.04);border-radius:6px;margin-bottom:6px;width:50%;"></div>
            <div style="height:60px;background:rgba(255,255,255,0.04);border-radius:6px;"></div>
        </div>
        <style>
            @keyframes pulse {
                0%,100% { opacity:0.4; }
                50% { opacity:0.6; }
            }
        </style>
    `;
}

export function hideSkeleton(containerId, content) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = content || '';
}