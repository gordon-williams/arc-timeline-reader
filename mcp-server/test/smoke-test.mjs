#!/usr/bin/env node
/**
 * MCP smoke test — spawns the server, calls list_tools and a handful of tool
 * executors over stdio JSON-RPC, asserts each returns sensible output.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, '..', 'index.js');
const fixturePath = path.resolve(__dirname, 'fixture.db');

const proc = spawn('node', [serverPath, fixturePath], {
    stdio: ['pipe', 'pipe', 'pipe']
});

let stderrBuf = '';
proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

// MCP over stdio uses newline-delimited JSON-RPC messages.
let recvBuf = '';
const pending = new Map();
let nextId = 1;

proc.stdout.on('data', (chunk) => {
    recvBuf += chunk.toString();
    let nl;
    while ((nl = recvBuf.indexOf('\n')) !== -1) {
        const line = recvBuf.slice(0, nl).trim();
        recvBuf = recvBuf.slice(nl + 1);
        if (!line) continue;
        try {
            const msg = JSON.parse(line);
            if (msg.id != null && pending.has(msg.id)) {
                const { resolve } = pending.get(msg.id);
                pending.delete(msg.id);
                resolve(msg);
            }
        } catch (err) {
            console.error('parse error:', err.message, line.slice(0, 200));
        }
    }
});

function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        proc.stdin.write(msg + '\n');
        setTimeout(() => {
            if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout on ${method}`)); }
        }, 8000);
    });
}

const assertions = [];
function expect(label, cond, hint = '') {
    assertions.push({ label, ok: !!cond, hint });
    console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : ' — ' + hint}`);
}

function findText(toolResult) {
    const c = toolResult?.result?.content || [];
    return c.map(p => p.text || '').join('\n');
}

async function callTool(name, args) {
    const res = await rpc('tools/call', { name, arguments: args });
    if (res.error) throw new Error(`${name} → ${res.error.message}`);
    return res;
}

(async () => {
    // Initialize handshake
    const init = await rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        clientInfo: { name: 'arc-smoke-test', version: '0.0.1' }
    });
    expect('initialize handshake succeeds', init?.result?.serverInfo?.name === 'arc-timeline-mcp');

    // Notify initialized
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    // List tools
    const tools = await rpc('tools/list', {});
    const names = tools?.result?.tools?.map(t => t.name) || [];
    expect('tools/list returns 15 tools', names.length === 15, `got ${names.length}: ${names.join(',')}`);
    expect('run_sql tool is present', names.includes('run_sql'));
    expect('search_notes tool is present', names.includes('search_notes'));

    // get_export_info
    {
        const r = await callTool('get_export_info', {});
        const info = JSON.parse(findText(r));
        expect('get_export_info returns 3 days', info.day_count === 3);
        expect('get_export_info build is 02.281-fixture', info.app_build === '02.281-fixture');
        expect('get_export_info includes_gps_samples = 1', info.includes_gps_samples === 1);
    }

    // get_schema
    {
        const r = await callTool('get_schema', {});
        const text = findText(r);
        expect('get_schema mentions timeline_items', text.includes('timeline_items'));
        expect('get_schema mentions temp.notes_fts', text.includes('temp.notes_fts'));
    }

    // run_sql — happy path
    {
        const r = await callTool('run_sql', { sql: 'SELECT COUNT(*) AS n FROM gps_samples' });
        const out = JSON.parse(findText(r));
        expect('run_sql counts gps_samples = 3', out.rows[0].n === 3);
    }

    // run_sql — must reject INSERT
    {
        const r = await callTool('run_sql', { sql: "INSERT INTO days VALUES ('hax','2026-05','0','x','x','{}')" });
        const text = findText(r);
        expect('run_sql rejects INSERT', r.result.isError === true && /allowed|forbidden/i.test(text), `text was: ${text}`);
    }

    // run_sql — must reject multi-statement
    {
        const r = await callTool('run_sql', { sql: 'SELECT 1; SELECT 2' });
        expect('run_sql rejects multiple statements', r.result.isError === true);
    }

    // get_top_locations
    {
        const r = await callTool('get_top_locations', { metric: 'visits', limit: 5 });
        const out = JSON.parse(findText(r));
        expect('top_locations[0] is Home', out.rows[0].name === 'Home');
        expect('top_locations[0].total_visits = 30', out.rows[0].total_visits === 30);
    }

    // find_days_in_region — bounding box covering Florence
    {
        const r = await callTool('find_days_in_region', {
            min_lat: 43.5, max_lat: 44.0, min_lng: 11.0, max_lng: 11.5
        });
        const out = JSON.parse(findText(r));
        expect('find_days_in_region returns 2026-05-21', out.days.length === 1 && out.days[0].day_key === '2026-05-21');
    }

    // get_elevation_stats — should find the 4200m sample
    {
        const r = await callTool('get_elevation_stats', { order: 'highest', limit: 3 });
        const out = JSON.parse(findText(r));
        expect('elevation top sample is 4200', out.rows[0].altitude_m === 4200);
    }

    // search_notes — FTS5 path
    {
        const r = await callTool('search_notes', { query: 'florence' });
        const out = JSON.parse(findText(r));
        expect('search_notes uses fts5', out.search_mode === 'fts5');
        expect('search_notes finds the Duomo note', out.matches.length === 1 && /Florence/i.test(out.matches[0].body));
    }

    // get_day_timeline
    {
        const r = await callTool('get_day_timeline', { day_key: '2026-05-21' });
        const out = JSON.parse(findText(r));
        expect('get_day_timeline returns 2 items', out.items.length === 2);
    }

    // get_activity_summary
    {
        const r = await callTool('get_activity_summary', { start_date: '2026-05-19', end_date: '2026-05-21' });
        const out = JSON.parse(findText(r));
        const walking = out.totals_by_activity.find(a => a.activity_type === 'walking');
        expect('activity_summary walking count = 6', walking && walking.count === 6); // 2/day * 3 days
        expect('activity_summary walking distance = 13500', walking && walking.distance_m === 13500);
    }

    // search_locations
    {
        const r = await callTool('search_locations', { query: 'flor' });
        const out = JSON.parse(findText(r));
        expect('search_locations finds Florence Cathedral', out.rows.some(r => r.name === 'Florence Cathedral'));
    }

    // Shutdown
    proc.kill('SIGTERM');

    const fails = assertions.filter(a => !a.ok);
    console.log(`\n${assertions.length - fails.length}/${assertions.length} assertions passed`);
    if (stderrBuf.trim()) {
        console.log('\nserver stderr:');
        console.log(stderrBuf.split('\n').map(l => '  ' + l).join('\n'));
    }
    process.exit(fails.length ? 1 : 0);
})().catch(err => {
    console.error('Test driver failed:', err);
    proc.kill('SIGTERM');
    process.exit(2);
});
