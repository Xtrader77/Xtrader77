// shared.js — Web/PWA shared utilities (replaces Electron IPC)
import { supabase, getCurrentUser, hashPin } from './db.js';

// ── Register Service Worker ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW:', e));
    });
}

// ── Auth Guard — call at top of every protected page ─────────────────────────
export async function requireAuth(redirectTo) {
    const user = await getCurrentUser();
    if (!user) {
        sessionStorage.setItem('xX_redirect', redirectTo || location.pathname);
        location.href = '/login.html';
        return null;
    }
    return user;
}

// ── PIN Guard — call after requireAuth on protected pages ─────────────────────
export async function requirePin() {
    const pinHash = localStorage.getItem('xX_app_pin');
    const unlocked = sessionStorage.getItem('xX_unlocked');
    if (pinHash && unlocked !== '1') {
        sessionStorage.setItem('xX_redirect', location.pathname);
        location.href = '/lock.html';
        return false;
    }
    return true;
}

// ── Confirm dialog (replaces electronAPI.showConfirm) ────────────────────────
export function showConfirm(msg) {
    return Promise.resolve(confirm(msg));
}

// ── Toast notification ────────────────────────────────────────────────────────
export function showToast(msg, type = 'info', duration = 3000) {
    let t = document.getElementById('__toast');
    if (!t) {
        t = document.createElement('div');
        t.id = '__toast';
        t.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(8px);
            background:#1a1a2e;border:1px solid rgba(74,144,226,0.3);color:#fff;padding:12px 22px;
            border-radius:50px;font-weight:600;font-size:13px;font-family:'Inter',sans-serif;
            opacity:0;transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);pointer-events:none;
            z-index:99999;white-space:nowrap;`;
        document.body.appendChild(t);
    }
    const colors = {
        success: 'rgba(29,185,84,0.15)',
        error: 'rgba(226,33,52,0.15)',
        info: 'rgba(74,144,226,0.15)'
    };
    const borders = {
        success: 'rgba(29,185,84,0.3)',
        error: 'rgba(226,33,52,0.3)',
        info: 'rgba(74,144,226,0.3)'
    };
    t.textContent = msg;
    t.style.background = colors[type] || colors.info;
    t.style.borderColor = borders[type] || borders.info;
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(-50%) translateY(8px)';
    }, duration);
}

// ── Bottom nav bar — inject on all main pages ─────────────────────────────────
export function injectBottomNav(activePage) {
    // Safety: if body isn't ready yet, wait for it
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', () => injectBottomNav(activePage));
        return;
    }
    // Don't inject twice
    if (document.getElementById('__bottomNav')) return;

    const nav = document.createElement('nav');
    nav.id = '__bottomNav';
    nav.style.cssText = `position:fixed;bottom:0;left:0;right:0;background:#0d0d0d;
        border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-around;
        align-items:center;padding:10px 0 max(10px,env(safe-area-inset-bottom));z-index:1000;`;

    const items = [
        { href: '/', icon: '🏠', label: 'HOME', key: 'home' },
        { href: '/journal.html', icon: '📝', label: 'TRADE', key: 'journal' },
        { href: '/dashboard.html', icon: '📊', label: 'DASH', key: 'dashboard' },
        { href: '/analytics.html', icon: '📈', label: 'STATS', key: 'analytics' },
        { href: '/improvement.html', icon: '🔧', label: 'IMPROVE', key: 'improvement' },
    ];

    items.forEach(({ href, icon, label, key }) => {
        const a = document.createElement('a');
        a.href = href;
        const isActive = key === activePage;
        a.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:3px;
            text-decoration:none;padding:4px 12px;border-radius:8px;transition:all 0.15s;
            color:${isActive ? '#fff' : 'rgba(255,255,255,0.35)'};`;
        a.innerHTML = `<span style="font-size:20px;line-height:1;">${icon}</span>
            <span style="font-size:9px;font-weight:${isActive ? '700' : '500'};letter-spacing:0.8px;">${label}</span>`;
        nav.appendChild(a);
    });

    document.body.style.paddingBottom = '72px';
    document.body.appendChild(nav);
}

// ── Export download helper ────────────────────────────────────────────────────
export function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

// ── Load trades + cycles from Supabase into localStorage cache ────────────────
const SYNC_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes

export async function syncToLocalStorage() {
    // If backup was just restored, skip cloud overwrite this session
    if (sessionStorage.getItem('xX_skip_sync') === '1') {
        sessionStorage.removeItem('xX_skip_sync');
        return;
    }

    // Throttle — don't hit Supabase more than once every 2 minutes
    const lastSync = parseInt(sessionStorage.getItem('xX_last_sync') || '0');
    const now = Date.now();
    if (now - lastSync < SYNC_THROTTLE_MS) return;
    sessionStorage.setItem('xX_last_sync', String(now));

    const { loadAllTrades, loadCycles, saveCycles } = await import('./db.js');
    try {
        const tradesResult = await loadAllTrades();
        if (tradesResult?.journals) {
            const existing = JSON.parse(localStorage.getItem('xX_journal_data') || '{}');
            const existingJournals = existing.journals || {};

            const merged = tradesResult.journals;
            Object.keys(merged).forEach(id => {
                const cloudTrade = merged[id];
                const localTrade = existingJournals[id];
                if (!cloudTrade.screenshots?.length && localTrade?.screenshots?.length) {
                    cloudTrade.screenshots = localTrade.screenshots;
                } else if (cloudTrade.screenshots?.length && localTrade?.screenshots?.length) {
                    cloudTrade.screenshots = cloudTrade.screenshots.map((ss, i) => {
                        if (ss.data) return ss;
                        const localSs = localTrade.screenshots[i];
                        return localSs?.data ? { ...ss, data: localSs.data } : ss;
                    });
                }
            });

            localStorage.setItem('xX_journal_data', JSON.stringify({
                journals: merged,
                tradeCounter: tradesResult.tradeCounter || 1,
                userName: existing.userName || 'Trader'
            }));

            // Recalculate cycles from actual trade count
            const allTrades = Object.values(merged).sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
            const allTradeIds = allTrades.map(t => t.tradeId);
            const totalTrades = allTrades.length;
            const completedCycles = Math.floor(totalTrades / 20);
            const tradesInCurrentCycle = totalTrades % 20;
            const currentCycle = completedCycles + 1;

            const completedCyclesArr = [];
            for (let i = 0; i < completedCycles; i++) {
                const lastTradeInCycle = allTrades[(i+1)*20 - 1];
                completedCyclesArr.push({ cycleNumber: i+1, completedAt: lastTradeInCycle?.timestamp || new Date().toISOString() });
            }

            const correctedCycles = { currentCycle, tradesInCurrentCycle, completedCycles: completedCyclesArr, allTrades: allTradeIds };
            localStorage.setItem('xX_cycle_data', JSON.stringify(correctedCycles));

            try { await saveCycles(correctedCycles); } catch(e) {}
        }
    } catch(e) { console.warn('sync trades:', e); }
}

// ── Fast boot helper — render from cache instantly, sync in background ────────
export async function requireAuthFast(redirectTo) {
    const user = await getCurrentUser();
    if (!user) {
        sessionStorage.setItem('xX_redirect', redirectTo || location.pathname);
        location.href = '/login.html';
        return null;
    }
    // Kick off background sync — don't await it
    syncToLocalStorage().catch(e => console.warn('bg sync:', e));
    return user;
}
    try {
        const tradesResult = await loadAllTrades();
        if (tradesResult?.journals) {
            // Preserve screenshot base64 data from existing localStorage cache
            const existing = JSON.parse(localStorage.getItem('xX_journal_data') || '{}');
            const existingJournals = existing.journals || {};

            const merged = tradesResult.journals;
            Object.keys(merged).forEach(id => {
                const cloudTrade = merged[id];
                const localTrade = existingJournals[id];
                if (!cloudTrade.screenshots?.length && localTrade?.screenshots?.length) {
                    cloudTrade.screenshots = localTrade.screenshots;
                } else if (cloudTrade.screenshots?.length && localTrade?.screenshots?.length) {
                    cloudTrade.screenshots = cloudTrade.screenshots.map((ss, i) => {
                        if (ss.data) return ss;
                        const localSs = localTrade.screenshots[i];
                        return localSs?.data ? { ...ss, data: localSs.data } : ss;
                    });
                }
            });

            localStorage.setItem('xX_journal_data', JSON.stringify({
                journals: merged,
                tradeCounter: tradesResult.tradeCounter || 1,
                userName: existing.userName || 'Trader'
            }));

            // Recalculate cycles from actual trade count — don't trust stale DB value
            const allTrades = Object.values(merged).sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
            const allTradeIds = allTrades.map(t => t.tradeId);
            const totalTrades = allTrades.length;
            const completedCycles = Math.floor(totalTrades / 20);
            const tradesInCurrentCycle = totalTrades % 20;
            const currentCycle = completedCycles + 1;

            const completedCyclesArr = [];
            for (let i = 0; i < completedCycles; i++) {
                const lastTradeInCycle = allTrades[(i+1)*20 - 1];
                completedCyclesArr.push({ cycleNumber: i+1, completedAt: lastTradeInCycle?.timestamp || new Date().toISOString() });
            }

            const correctedCycles = {
                currentCycle,
                tradesInCurrentCycle,
                completedCycles: completedCyclesArr,
                allTrades: allTradeIds
            };
            localStorage.setItem('xX_cycle_data', JSON.stringify(correctedCycles));

            // Push corrected cycles back to Supabase silently
            try {
                const { saveCycles } = await import('./db.js');
                await saveCycles(correctedCycles);
            } catch(e) { console.warn('cycle sync back:', e); }
        }
    } catch(e) { console.warn('sync trades:', e); }
}
