// db.js — xX Trading Journal Database Layer (Optimized)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://ispiarjnlvdslgdjnwuv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzcGlhcmpubHZkc2xnZGpud3V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NDEyNTUsImV4cCI6MjA5NTAxNzI1NX0.0sxl43WIR2NOvvHJv6ZZvdn56UwGQo9AutzSDStQcaU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { 
        persistSession: true, 
        autoRefreshToken: true, 
        detectSessionInUrl: false,
        storageKey: 'xX_sb_auth'
    }
});

// ── IndexedDB Cache ──────────────────────────────────────────────────────────
const DB_NAME = 'xXJournalDB';
const DB_VERSION = 2;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('trades')) {
                const store = db.createObjectStore('trades', { keyPath: 'id' });
                store.createIndex('userId', 'user_id', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains('cycles')) {
                db.createObjectStore('cycles', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('screenshots')) {
                const store = db.createObjectStore('screenshots', { keyPath: 'id' });
                store.createIndex('tradeId', 'trade_id', { unique: false });
            }
            if (!db.objectStoreNames.contains('metadata')) {
                db.createObjectStore('metadata', { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ── Cache Helpers ─────────────────────────────────────────────────────────────
export async function cacheTrades(trades) {
    try {
        const db = await openDB();
        const tx = db.transaction('trades', 'readwrite');
        const store = tx.objectStore('trades');
        for (const t of trades) {
            store.put(t);
        }
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = reject;
        });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function getCachedTrades(userId) {
    try {
        const db = await openDB();
        const tx = db.transaction('trades', 'readonly');
        const store = tx.objectStore('trades');
        const index = store.index('userId');
        const trades = await new Promise((resolve, reject) => {
            const req = index.getAll(userId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return { success: true, data: trades };
    } catch (e) {
        return { success: false, error: e.message, data: [] };
    }
}

export async function cacheCycles(cycles) {
    try {
        const db = await openDB();
        const tx = db.transaction('cycles', 'readwrite');
        const store = tx.objectStore('cycles');
        store.put(cycles);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = reject;
        });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function getCachedCycles() {
    try {
        const db = await openDB();
        const tx = db.transaction('cycles', 'readonly');
        const store = tx.objectStore('cycles');
        const data = await new Promise((resolve, reject) => {
            const req = store.get('user_cycles');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return { success: true, data: data?.value || null };
    } catch (e) {
        return { success: false, error: e.message, data: null };
    }
}

export async function setMetadata(key, value) {
    try {
        const db = await openDB();
        const tx = db.transaction('metadata', 'readwrite');
        const store = tx.objectStore('metadata');
        store.put({ key, value });
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = reject;
        });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function getMetadata(key) {
    try {
        const db = await openDB();
        const tx = db.transaction('metadata', 'readonly');
        const store = tx.objectStore('metadata');
        const data = await new Promise((resolve, reject) => {
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return { success: true, data: data?.value || null };
    } catch (e) {
        return { success: false, error: e.message, data: null };
    }
}

// ── PIN hash ──────────────────────────────────────────────────────────────────
export function hashPin(pin) {
    let h = 5381;
    for (let i = 0; i < pin.length; i++) {
        h = ((h << 5) ^ h) ^ (pin.charCodeAt(i) * (i + 7));
        h = h >>> 0;
    }
    return String(h);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function signUp(email, password, name, style) {
    const { data, error } = await supabase.auth.signUp({ 
        email, password,
        options: { data: { name, trading_style: style } }
    });
    if (error) return { success: false, error: error.message };
    if (data.user) {
        await supabase.from('profiles').upsert({ 
            id: data.user.id, 
            name: name || email.split('@')[0],
            trading_style: style || '',
            created_at: new Date().toISOString()
        });
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
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/login.html'
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ── Profile ───────────────────────────────────────────────────────────────────
export async function getProfile() {
    const user = await getCurrentUser();
    if (!user) return null;
    const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
    return data;
}

export async function saveProfile(profileData) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    const { error } = await supabase
        .from('profiles')
        .upsert({ 
            id: user.id, 
            ...profileData, 
            updated_at: new Date().toISOString() 
        });
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function savePinHash(pinHash) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    const { error } = await supabase
        .from('profiles')
        .upsert({ 
            id: user.id, 
            pin_hash: pinHash, 
            updated_at: new Date().toISOString() 
        });
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function removePinHash() {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    const { error } = await supabase
        .from('profiles')
        .update({ 
            pin_hash: null, 
            recovery_question: null, 
            recovery_answer_hash: null,
            updated_at: new Date().toISOString() 
        })
        .eq('id', user.id);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function saveRecovery(question, answerHash) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    const { error } = await supabase
        .from('profiles')
        .upsert({ 
            id: user.id, 
            recovery_question: question, 
            recovery_answer_hash: answerHash,
            updated_at: new Date().toISOString() 
        });
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ── Trades (Optimized) ──────────────────────────────────────────────────────
export async function saveTrade(tradeId, tradeData) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };

    // Small screenshots only — compress if too large
    let screenshots = [];
    if (tradeData.screenshots?.length) {
        screenshots = tradeData.screenshots.map(ss => ({
            ...ss,
            data: ss.data?.length > 500000 ? ss.data : ss.data // keep as-is, we compress on upload
        }));
    }

    const row = {
        id: tradeId,
        user_id: user.id,
        pair: tradeData.pair || null,
        direction: tradeData.direction || null,
        outcome: tradeData.outcome || null,
        trade_date: tradeData.tradeDate || null,
        trade_time: tradeData.tradeTime || null,
        is_backdated: tradeData.isBackdated || false,
        timestamp: tradeData.timestamp || new Date().toISOString(),
        journal_text: tradeData.text || null,
        reason: tradeData.reason || null,
        execution: tradeData.execution || null,
        session: tradeData.tradeSession?.session || null,
        mindset: tradeData.mindset || null,
        execution_rating: tradeData.executionRating || null,
        rule_breaks: JSON.stringify(tradeData.ruleBreaks || []),
        checklist: JSON.stringify(tradeData.checklist || []),
        mt4_data: tradeData.mt4 ? JSON.stringify(tradeData.mt4) : null,
        cycle_number: tradeData.cycleNumber || 1,
        updated_at: new Date().toISOString()
    };

    const { error: tradeError } = await supabase
        .from('trades')
        .upsert(row, { onConflict: 'id' });

    if (tradeError) {
        return { success: false, error: tradeError.message };
    }

    // Save screenshots in batch
    if (screenshots.length > 0) {
        await supabase
            .from('screenshots')
            .delete()
            .eq('trade_id', tradeId)
            .eq('user_id', user.id);

        const ssRows = screenshots.map((ss, i) => ({
            id: `${tradeId}_${i}`,
            trade_id: tradeId,
            user_id: user.id,
            name: ss.name || `screenshot_${i}`,
            annotation: ss.annotation || '',
            data: ss.data,
            created_at: new Date().toISOString()
        }));

        // Insert in chunks to avoid payload limits
        for (let i = 0; i < ssRows.length; i += 5) {
            const chunk = ssRows.slice(i, i + 5);
            const { error: ssError } = await supabase
                .from('screenshots')
                .upsert(chunk, { onConflict: 'id' });
            if (ssError) console.warn('Screenshot save error:', ssError.message);
        }
    }

    // Update cache
    const cached = await getCachedTrades(user.id);
    if (cached.success) {
        const existing = cached.data.find(t => t.id === tradeId);
        if (existing) {
            Object.assign(existing, row);
        } else {
            cached.data.push(row);
        }
        await cacheTrades(cached.data);
    }

    return { success: true };
}

export async function loadAllTrades(includeScreenshots = false) {
    const user = await getCurrentUser();
    if (!user) return { journals: {}, tradeCounter: 1 };

    // Try cache first
    const cached = await getCachedTrades(user.id);
    if (cached.success && cached.data.length > 0) {
        const journals = {};
        let maxCounter = 1;
        for (const t of cached.data) {
            const num = parseInt((t.id || '').replace('TRADE_', '')) || 0;
            if (num >= maxCounter) maxCounter = num + 1;
            
            journals[t.id] = {
                text: t.journal_text,
                checklist: safeJSON(t.checklist, []),
                ruleBreaks: safeJSON(t.rule_breaks, []),
                tradeSession: { session: t.session, time: t.trade_time },
                execution: t.execution,
                screenshots: [],
                pair: t.pair,
                direction: t.direction,
                reason: t.reason,
                outcome: t.outcome,
                timestamp: t.timestamp,
                tradeDate: t.trade_date,
                tradeTime: t.trade_time,
                isBackdated: t.is_backdated,
                tradeId: t.id,
                mindset: t.mindset,
                executionRating: t.execution_rating,
                mt4: t.mt4_data ? safeJSON(t.mt4_data, null) : null,
                cycleNumber: t.cycle_number
            };
        }
        return { journals, tradeCounter: maxCounter };
    }

    // Fetch from network
    const { data: trades, error } = await supabase
        .from('trades')
        .select('id, pair, direction, outcome, trade_date, trade_time, is_backdated, timestamp, journal_text, reason, execution, session, mindset, execution_rating, rule_breaks, checklist, mt4_data, cycle_number')
        .eq('user_id', user.id)
        .order('timestamp', { ascending: true })
        .limit(500);

    if (error || !trades) {
        return { journals: {}, tradeCounter: 1 };
    }

    // Cache results
    await cacheTrades(trades.map(t => ({ ...t, user_id: user.id })));

    const journals = {};
    let maxCounter = 1;
    for (const t of trades) {
        const num = parseInt((t.id || '').replace('TRADE_', '')) || 0;
        if (num >= maxCounter) maxCounter = num + 1;
        
        journals[t.id] = {
            text: t.journal_text,
            checklist: safeJSON(t.checklist, []),
            ruleBreaks: safeJSON(t.rule_breaks, []),
            tradeSession: { session: t.session, time: t.trade_time },
            execution: t.execution,
            screenshots: [],
            pair: t.pair,
            direction: t.direction,
            reason: t.reason,
            outcome: t.outcome,
            timestamp: t.timestamp,
            tradeDate: t.trade_date,
            tradeTime: t.trade_time,
            isBackdated: t.is_backdated,
            tradeId: t.id,
            mindset: t.mindset,
            executionRating: t.execution_rating,
            mt4: t.mt4_data ? safeJSON(t.mt4_data, null) : null,
            cycleNumber: t.cycle_number
        };
    }

    // Load screenshots only if requested (lazy)
    if (includeScreenshots) {
        const { data: ssData } = await supabase
            .from('screenshots')
            .select('trade_id, id, name, annotation, data')
            .eq('user_id', user.id);

        if (ssData) {
            for (const ss of ssData) {
                if (journals[ss.trade_id]) {
                    if (!journals[ss.trade_id].screenshots) {
                        journals[ss.trade_id].screenshots = [];
                    }
                    journals[ss.trade_id].screenshots.push({
                        id: ss.id,
                        name: ss.name,
                        annotation: ss.annotation,
                        data: ss.data
                    });
                }
            }
        }
    }

    return { journals, tradeCounter: maxCounter };
}

export async function deleteTrade(tradeId) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };
    
    await supabase
        .from('screenshots')
        .delete()
        .eq('trade_id', tradeId)
        .eq('user_id', user.id);
    
    const { error } = await supabase
        .from('trades')
        .delete()
        .eq('id', tradeId)
        .eq('user_id', user.id);
    
    if (error) return { success: false, error: error.message };

    // Update cache
    const cached = await getCachedTrades(user.id);
    if (cached.success) {
        const filtered = cached.data.filter(t => t.id !== tradeId);
        await cacheTrades(filtered);
    }

    return { success: true };
}

// ── Cycles ────────────────────────────────────────────────────────────────────
export async function saveCycles(cyclesData) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Not logged in' };

    const row = {
        id: 'user_cycles',
        user_id: user.id,
        current_cycle: cyclesData.currentCycle || 1,
        trades_in_current_cycle: cyclesData.tradesInCurrentCycle || 0,
        completed_cycles: JSON.stringify(cyclesData.completedCycles || []),
        all_trades: JSON.stringify(cyclesData.allTrades || []),
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('cycles')
        .upsert(row, { onConflict: 'id' });

    if (error) return { success: false, error: error.message };

    // Update cache
    await cacheCycles({ id: 'user_cycles', value: cyclesData });

    return { success: true };
}

export async function loadCycles() {
    const user = await getCurrentUser();
    if (!user) return { 
        currentCycle: 1, 
        tradesInCurrentCycle: 0, 
        completedCycles: [], 
        allTrades: [] 
    };

    // Try cache first
    const cached = await getCachedCycles();
    if (cached.success && cached.data) {
        return cached.data;
    }

    const { data } = await supabase
        .from('cycles')
        .select('*')
        .eq('user_id', user.id)
        .single();

    if (!data) {
        return { 
            currentCycle: 1, 
            tradesInCurrentCycle: 0, 
            completedCycles: [], 
            allTrades: [] 
        };
    }

    const result = {
        currentCycle: data.current_cycle,
        tradesInCurrentCycle: data.trades_in_current_cycle,
        completedCycles: safeJSON(data.completed_cycles, []),
        allTrades: safeJSON(data.all_trades, [])
    };

    await cacheCycles({ id: 'user_cycles', value: result });

    return result;
}

function safeJSON(val, fallback) {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return fallback; }
}