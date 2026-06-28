// db.js — xX Trading Journal Web/PWA database layer
// Supabase direct browser client (no Electron IPC)

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = 'https://ispiarjnlvdslgdjnwuv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzcGlhcmpubHZkc2xnZGpud3V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NDEyNTUsImV4cCI6MjA5NTAxNzI1NX0.0sxl43WIR2NOvvHJv6ZZvdn56UwGQo9AutzSDStQcaU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// ── PIN hash (djb2-xor, matches desktop version) ──────────────────────────────
export function hashPin(pin) {
    let h = 5381;
    for (let i = 0; i < pin.length; i++) {
        h = ((h << 5) ^ h) ^ (pin.charCodeAt(i) * (i + 7));
        h = h >>> 0;
    }
    return String(h);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function signUp(email, password, name) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { success: false, error: error.message };
    if (data.user) {
        await supabase.from('profiles').upsert({ id: data.user.id, name: name || email.split('@')[0] });
    }
    return { success: true, user: data.user };
}

export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: error.message };
    return { success: true, user: data.user };
}

export async function signOut() {
    await supabase.auth.signOut();
    return { success: true };
}

export async function getCurrentUser() {
    // First try local session — instant, no network call
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) return session.user;
    // Fallback to network check if no local session
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/index.html'
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ── Profile ───────────────────────────────────────────────────────────────────
export async function getProfile() {
    const user = await getCurrentUser();
    if (!user) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    return data;
}

export async function saveProfile(profileData) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    const { error } = await supabase.from('profiles')
        .upsert({ id: user.id, ...profileData, updated_at: new Date().toISOString() });
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function savePinHash(pinHash) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    const { error } = await supabase.from('profiles')
        .upsert({ id: user.id, pin_hash: pinHash, updated_at: new Date().toISOString() });
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function removePinHash() {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    const { error } = await supabase.from('profiles')
        .update({ pin_hash: null, recovery_question: null, recovery_answer_hash: null, updated_at: new Date().toISOString() })
        .eq('id', user.id);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function saveRecovery(question, answerHash) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    const { error } = await supabase.from('profiles')
        .upsert({ id: user.id, recovery_question: question, recovery_answer_hash: answerHash, updated_at: new Date().toISOString() });
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ── Trades ────────────────────────────────────────────────────────────────────
export async function saveTrade(tradeId, tradeData) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };

    const row = {
        id: tradeId, user_id: user.id,
        pair: tradeData.pair || null, direction: tradeData.direction || null,
        outcome: tradeData.outcome || null, trade_date: tradeData.tradeDate || null,
        trade_time: tradeData.tradeTime || null, is_backdated: tradeData.isBackdated || false,
        timestamp: tradeData.timestamp || new Date().toISOString(),
        journal_text: tradeData.text || null, reason: tradeData.reason || null,
        execution: tradeData.execution || null,
        session: tradeData.tradeSession?.session || null,
        mindset: tradeData.mindset || null, execution_rating: tradeData.executionRating || null,
        rule_breaks: JSON.stringify(tradeData.ruleBreaks || []),
        checklist: JSON.stringify(tradeData.checklist || []),
        mt4_data: tradeData.mt4 ? JSON.stringify(tradeData.mt4) : null,
        cycle_number: tradeData.cycleNumber || 1
    };

    const { error: tradeError } = await supabase.from('trades').upsert(row);
    if (tradeError) {
        const msg = tradeError.code === '42501'
            ? 'RLS error on trades table — run the SQL fix in Supabase dashboard'
            : tradeError.message;
        return { success: false, error: msg };
    }

    if (tradeData.screenshots?.length > 0) {
        await supabase.from('screenshots').delete().eq('trade_id', tradeId).eq('user_id', user.id);
        for (let i = 0; i < tradeData.screenshots.length; i++) {
            const ss = tradeData.screenshots[i];
            if (!ss.data) continue;
            const name = `ss_${i}_${ss.name || 'screenshot'}`.substring(0, 100);
            const { error: ssError } = await supabase.from('screenshots').insert({
                trade_id: tradeId, user_id: user.id,
                name, annotation: ss.annotation || '', data: ss.data
            });
            if (ssError) console.warn('Screenshot save error:', ssError.message);
        }
    }
    return { success: true };
}

export async function loadAllTrades(includeScreenshots = false) {
    const user = await getCurrentUser();
    if (!user) return { journals: {}, tradeCounter: 1 };

    const { data: trades, error } = await supabase
        .from('trades').select('*').eq('user_id', user.id).order('timestamp', { ascending: true });
    if (error || !trades) return { journals: {}, tradeCounter: 1 };

    // Only fetch screenshots if explicitly requested (slower but complete)
    let ssByTrade = {};
    if (includeScreenshots) {
        const { data: screenshots } = await supabase
            .from('screenshots').select('trade_id, id, name, annotation, data').eq('user_id', user.id);
        (screenshots || []).forEach(ss => {
            if (!ssByTrade[ss.trade_id]) ssByTrade[ss.trade_id] = [];
            ssByTrade[ss.trade_id].push({ id: ss.id, name: ss.name, annotation: ss.annotation, data: ss.data });
        });
    }

    const journals = {};
    let maxCounter = 1;
    trades.forEach(t => {
        const num = parseInt((t.id || '').replace('TRADE_', '')) || 0;
        if (num >= maxCounter) maxCounter = num + 1;
        // Use local screenshots if we have them (avoids re-fetching base64 blobs)
        const localData = JSON.parse(localStorage.getItem('xX_journal_data') || '{}');
        const localSS = localData.journals?.[t.id]?.screenshots || [];
        journals[t.id] = {
            text: t.journal_text, checklist: safeJSON(t.checklist, []),
            ruleBreaks: safeJSON(t.rule_breaks, []),
            tradeSession: { session: t.session, time: t.trade_time },
            execution: t.execution, screenshots: ssByTrade[t.id] || localSS,
            pair: t.pair, direction: t.direction, reason: t.reason,
            outcome: t.outcome, timestamp: t.timestamp,
            tradeDate: t.trade_date, tradeTime: t.trade_time,
            isBackdated: t.is_backdated, tradeId: t.id,
            mindset: t.mindset, executionRating: t.execution_rating,
            mt4: t.mt4_data ? safeJSON(t.mt4_data, null) : null,
            cycleNumber: t.cycle_number
        };
    });
    return { journals, tradeCounter: maxCounter };
}

export async function deleteTrade(tradeId) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    await supabase.from('screenshots').delete().eq('trade_id', tradeId).eq('user_id', user.id);
    const { error } = await supabase.from('trades').delete().eq('id', tradeId).eq('user_id', user.id);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ── Cycles ────────────────────────────────────────────────────────────────────
export async function saveCycles(cyclesData) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    const { data: existing } = await supabase.from('cycles').select('id').eq('user_id', user.id).single();
    const row = {
        user_id: user.id,
        current_cycle: cyclesData.currentCycle || 1,
        trades_in_current_cycle: cyclesData.tradesInCurrentCycle || 0,
        completed_cycles: JSON.stringify(cyclesData.completedCycles || []),
        all_trades: JSON.stringify(cyclesData.allTrades || [])
    };
    if (existing?.id) row.id = existing.id;
    const { error } = await supabase.from('cycles').upsert(row);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function loadCycles() {
    const user = await getCurrentUser();
    if (!user) return { currentCycle: 1, tradesInCurrentCycle: 0, completedCycles: [], allTrades: [] };
    const { data } = await supabase.from('cycles').select('*').eq('user_id', user.id).single();
    if (!data) return { currentCycle: 1, tradesInCurrentCycle: 0, completedCycles: [], allTrades: [] };
    return {
        currentCycle: data.current_cycle,
        tradesInCurrentCycle: data.trades_in_current_cycle,
        completedCycles: safeJSON(data.completed_cycles, []),
        allTrades: safeJSON(data.all_trades, [])
    };
}

function safeJSON(val, fallback) {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return fallback; }
}
