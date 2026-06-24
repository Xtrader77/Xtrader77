// shared.js — xX Trading Journal PWA utilities
import { supabase, getCurrentUser, hashPin } from './db.js';

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

// ── Fast auth — render from cache instantly, sync DB in background ────────────
export async function requireAuthFast(redirectTo) {
    const user = await getCurrentUser();
    if (!user) {
        sessionStorage.setItem('xX_redirect', redirectTo || location.pathname);
        location.href = '/login.html';
        return null;
    }
    // Fire background sync — never awaited, never blocks render
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

// ── Toast ─────────────────────────────────────────────────────────────────────
export function showToast(msg, type = 'info', duration = 3000) {
    let t = document.getElementById('__toast');
    if (!t) {
        t = document.createElement('div');
        t.id = '__toast';
        t.style.cssText = [
            'position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(6px)',
            'padding:11px 20px;border-radius:50px;font-weight:600;font-size:13px',
            'font-family:Inter,sans-serif;opacity:0;pointer-events:none;z-index:99999',
            'white-space:nowrap;transition:all 0.25s ease;border:1px solid'
        ].join(';');
        document.body.appendChild(t);
    }
    const cfg = {
        success: ['rgba(29,185,84,0.15)',  'rgba(29,185,84,0.4)'],
        error:   ['rgba(226,33,52,0.15)',  'rgba(226,33,52,0.4)'],
        info:    ['rgba(74,144,226,0.15)', 'rgba(74,144,226,0.4)']
    };
    const [bg, bd] = cfg[type] || cfg.info;
    t.textContent = msg;
    t.style.background   = bg;
    t.style.borderColor  = bd;
    t.style.color        = '#fff';
    t.style.opacity      = '1';
    t.style.transform    = 'translateX(-50%) translateY(0)';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => {
        t.style.opacity   = '0';
        t.style.transform = 'translateX(-50%) translateY(6px)';
    }, duration);
}

// ── Bottom nav ────────────────────────────────────────────────────────────────
export function injectBottomNav(activePage) {
    if (document.getElementById('__bnav')) return;
    const inject = () => {
        if (document.getElementById('__bnav')) return;
        const nav = document.createElement('nav');
        nav.id = '__bnav';
        nav.style.cssText = [
            'position:fixed;bottom:0;left:0;right:0;background:#0a0a0a',
            'border-top:1px solid rgba(255,255,255,0.07)',
            'display:flex;justify-content:space-around;align-items:center',
            'padding:8px 0 max(8px,env(safe-area-inset-bottom));z-index:9000'
        ].join(';');

        [
            ['/', '🏠', 'HOME', 'home'],
            ['/journal.html', '📝', 'TRADE', 'journal'],
            ['/dashboard.html', '📊', 'DASH', 'dashboard'],
            ['/analytics.html', '📈', 'STATS', 'analytics'],
            ['/improvement.html', '🔧', 'IMPROVE', 'improvement'],
        ].forEach(([href, icon, label, key]) => {
            const a = document.createElement('a');
            a.href = href;
            const active = key === activePage;
            a.style.cssText = [
                'display:flex;flex-direction:column;align-items:center;gap:2px',
                'text-decoration:none;padding:4px 10px;border-radius:8px',
                `color:${active ? '#fff' : 'rgba(255,255,255,0.32)'}`
            ].join(';');
            a.innerHTML = `<span style="font-size:19px;line-height:1">${icon}</span>`
                + `<span style="font-size:9px;font-weight:${active?700:500};letter-spacing:0.7px">${label}</span>`;
            nav.appendChild(a);
        });

        document.body.style.paddingBottom = '68px';
        document.body.appendChild(nav);
    };

    if (document.body) inject();
    else document.addEventListener('DOMContentLoaded', inject);
}

// ── Background sync ───────────────────────────────────────────────────────────
// Throttle: only sync once per 3 minutes per session
const THROTTLE = 3 * 60 * 1000;

function _bgSync() {
    if (sessionStorage.getItem('xX_skip_sync') === '1') {
        sessionStorage.removeItem('xX_skip_sync');
        return;
    }
    const last = parseInt(sessionStorage.getItem('xX_last_sync') || '0');
    if (Date.now() - last < THROTTLE) return;
    sessionStorage.setItem('xX_last_sync', String(Date.now()));

    // Run async without blocking anything
    setTimeout(async () => {
        try {
            const { loadAllTrades, saveCycles } = await import('./db.js');
            const result = await loadAllTrades();
            if (!result?.journals) return;

            // Merge screenshots: prefer cloud data, fallback to local base64
            const local = JSON.parse(localStorage.getItem('xX_journal_data') || '{}');
            const localJ = local.journals || {};
            const merged = result.journals;

            for (const id of Object.keys(merged)) {
                const ct = merged[id], lt = localJ[id];
                if (!ct.screenshots?.length && lt?.screenshots?.length) {
                    ct.screenshots = lt.screenshots;
                } else if (ct.screenshots?.length && lt?.screenshots?.length) {
                    ct.screenshots = ct.screenshots.map((ss, i) =>
                        ss.data ? ss : (lt.screenshots[i]?.data ? { ...ss, data: lt.screenshots[i].data } : ss)
                    );
                }
            }

            localStorage.setItem('xX_journal_data', JSON.stringify({
                journals: merged,
                tradeCounter: result.tradeCounter || 1,
                userName: local.userName || 'Trader'
            }));

            // Recalculate cycles from real trade count — never trust stale DB
            const sorted = Object.values(merged).sort((a,b) => +new Date(a.timestamp) - +new Date(b.timestamp));
            const total  = sorted.length;
            const done   = Math.floor(total / 20);
            const inCur  = total % 20;
            const cycles = {
                currentCycle: done + 1,
                tradesInCurrentCycle: inCur,
                completedCycles: Array.from({length: done}, (_, i) => ({
                    cycleNumber: i + 1,
                    completedAt: sorted[(i+1)*20 - 1]?.timestamp || new Date().toISOString()
                })),
                allTrades: sorted.map(t => t.tradeId)
            };
            localStorage.setItem('xX_cycle_data', JSON.stringify(cycles));
            saveCycles(cycles).catch(() => {});
        } catch(e) {
            console.warn('[bgSync]', e);
        }
    }, 100); // tiny delay so page renders first
}

// ── Manual sync (for sync buttons) ───────────────────────────────────────────
export async function syncToLocalStorage() {
    sessionStorage.removeItem('xX_last_sync'); // force even if throttled
    _bgSync();
}

// ── Download helper ───────────────────────────────────────────────────────────
export function downloadFile(content, filename, mimeType) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
    a.download = filename;
    a.click();
}
