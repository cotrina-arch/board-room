const express = require('express');
const fs = require('fs');
const http = require('http');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8443;
const PAPERCLIP_URL = process.env.PAPERCLIP_URL || 'http://127.0.0.1:3101';
const COMPANY_ID = process.env.COMPANY_ID || '0092581a-c9dc-42ed-92c7-e0200be10a03';
const VOTES_FILE = process.env.VOTES_FILE || '/Users/cristian/boardroom/votes.json';
const USERS = ['Cristian', 'Andrew', 'Justin', 'Kausar'];

// --- Votes storage: Vercel KV (when KV_REST_API_URL set) or local file ---
async function loadVotes() {
  if (process.env.KV_REST_API_URL) {
    try {
      const r = await fetch(process.env.KV_REST_API_URL + '/get/votes', {
        headers: { Authorization: 'Bearer ' + process.env.KV_REST_API_TOKEN }
      });
      const j = await r.json();
      return j.result ? JSON.parse(j.result) : {};
    } catch (e) { return {}; }
  }
  try { return JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8')); }
  catch (e) { return {}; }
}
async function saveVotes(v) {
  if (process.env.KV_REST_API_URL) {
    await fetch(process.env.KV_REST_API_URL + '/set/votes', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.KV_REST_API_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(v) })
    });
    return;
  }
  fs.writeFileSync(VOTES_FILE, JSON.stringify(v, null, 2));
}

async function paperclipGet(path) {
  const r = await fetch(PAPERCLIP_URL + '/api' + path);
  return r.json().catch(() => ({}));
}

async function paperclipPost(path, body) {
  const r = await fetch(PAPERCLIP_URL + '/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json().catch(() => ({}));
}

function mdToHtml(md) {
  if (!md) return '';
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\|(.+)\|/g, (_, row) => {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.every(c => /^[-:]+$/.test(c))) return '';
      return '<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
    })
    .replace(/(<tr>[\s\S]+?<\/tr>)/g, '<table>$1</table>')
    .replace(/<\/table>\s*<table>/g, '')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => '<ul>' + m + '</ul>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\n\n/g, '\n');
}

function buildProposalList(approvals, votes) {
  const list = [];
  for (const a of (Array.isArray(approvals) ? approvals : [])) {
    if (a.type !== 'approve_ceo_strategy') continue;
    const plan = (a.payload && a.payload.plan) || '';
    // Split on # / ## headings that mark a pitch. Accepts:
    //   "# PITCH 2:", "# Pitch 2 —", "# Pitch #2 — Foo", "# 🦈 Shark Tank Pitch:"
    const pitchSplitRe = /(?=^#{1,2}\s+(?:[\u{1F988}\s]*)?(?:Pitch\s*#?\s*\d+|Shark Tank Pitch)[:\s\u2014\-])/imu;
    const pitchBlocks = plan.split(pitchSplitRe).map(s => s.trim()).filter(s => {
      const first = s.split('\n')[0];
      return /Shark Tank Pitch|Pitch\s*#?\s*\d+/i.test(first);
    });

    if (pitchBlocks.length <= 1) {
      const m = plan.match(/^#+[\s\u{1F988}]*(.*?)$/um);
      const title = m ? m[1].trim() : 'CEO Proposal';
      const vData = votes[a.id] || { votes: [], comments: [] };
      list.push(Object.assign({}, a, { title, contentHtml: mdToHtml(plan), localVotes: vData.votes, localComments: vData.comments }));
    } else {
      for (let i = 0; i < pitchBlocks.length; i++) {
        const block = pitchBlocks[i].trim();
        const firstLine = block.split('\n')[0];
        const titleMatch = firstLine.match(/(?:Shark Tank Pitch:|Pitch\s*#?\s*\d+\s*[:\u2014\-]+\s*)(.+)$/i);
        const title = titleMatch ? titleMatch[1].trim() : 'Pitch ' + (i + 1);
        const syntheticId = a.id + '__pitch' + i;
        const vData = votes[syntheticId] || { votes: [], comments: [] };
        list.push({ id: syntheticId, type: a.type, status: a.status, createdAt: a.createdAt, _parentId: a.id, title, contentHtml: mdToHtml(block), localVotes: vData.votes, localComments: vData.comments });
      }
    }
  }
  // Newest first
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}


function loginHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Board Room - App Factory</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080808;color:#e8e8e8;font-family:'Helvetica Neue',Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center}
.logo{font-size:11px;font-weight:600;letter-spacing:0.1em;color:#333;text-transform:uppercase;margin-bottom:48px}
.logo span{color:#666}
h1{font-size:22px;font-weight:300;letter-spacing:-0.3px;margin-bottom:8px;color:#ccc}
p{font-size:13px;color:#333;margin-bottom:40px}
.members{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:400px}
.mbtn{padding:16px 28px;background:#0d0d0d;border:1px solid #1e1e1e;border-radius:12px;color:#777;font-size:15px;font-weight:500;cursor:pointer;text-decoration:none;transition:all .2s;min-width:160px;text-align:center;display:block}
.mbtn:hover{background:#141414;color:#ccc;border-color:#2a2a2a}
</style></head>
<body>
<div class="logo">App Factory &middot; <span>Board Room</span></div>
<h1>Who are you?</h1>
<p>Select your name to enter the Board Room</p>
<div class="members">
  <a class="mbtn" href="/?user=Cristian">Cristian</a>
  <a class="mbtn" href="/?user=Andrew">Andrew</a>
  <a class="mbtn" href="/?user=Justin">Justin</a>
  <a class="mbtn" href="/?user=Kausar">Kausar</a>
</div>
</body></html>`;
}

function mainHtml(user) {
  const today = new Date().toISOString().slice(0, 10);
  const safeUser = USERS.includes(user) ? user : 'Guest';
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Board Room - App Factory</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080808;color:#e8e8e8;font-family:'Helvetica Neue',Arial,sans-serif;min-height:100vh}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;border-bottom:1px solid #141414;position:sticky;top:0;background:#080808;z-index:10}
.logo{font-size:11px;font-weight:600;letter-spacing:0.1em;color:#444;text-transform:uppercase}
.logo span{color:#aaa}
.userbadge{font-size:12px;color:#444;display:flex;align-items:center;gap:8px}
.userbadge strong{color:#888}
.user-select{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:6px;color:#888;font-size:12px;padding:4px 8px;cursor:pointer;outline:none}
.user-select:hover{border-color:#2a2a2a}
.tabs{display:flex;gap:0;border-bottom:1px solid #141414;padding:0 32px;background:#090909}
.tab{padding:14px 22px;font-size:12px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:#2e2e2e;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
.tab:hover{color:#555}
.tab.active{color:#aaa;border-bottom-color:#333}
main{max-width:900px;margin:0 auto;padding:44px 24px 100px}
.page-title{font-size:26px;font-weight:300;letter-spacing:-0.5px;margin-bottom:6px}
.page-sub{color:#333;font-size:13px;margin-bottom:36px;line-height:1.6}
.date-bar-wrap{margin-bottom:28px}
.date-bar{display:flex;align-items:center;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.date-bar::-webkit-scrollbar{display:none}
.dday{padding:7px 14px;background:#141414;border:1px solid #1e1e1e;border-radius:20px;color:#444;font-size:12px;font-weight:500;cursor:pointer;transition:all .15s;white-space:nowrap;flex-shrink:0}
.dday:hover{background:#1a1a1a;color:#aaa;border-color:#2a2a2a}
.dday.active{background:#0a180a;border-color:#0f2e0f;color:#3dba6e}
.dday.today-badge{border-color:#1e3a1e}
.dcal-btn{padding:7px 12px;background:#141414;border:1px solid #1e1e1e;border-radius:20px;color:#333;font-size:13px;cursor:pointer;transition:all .15s;flex-shrink:0;line-height:1}
.dcal-btn:hover{color:#aaa;border-color:#2a2a2a}
.dcal-input{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
.cal-date-label{font-size:14px;color:#444;margin-top:8px}
.cal-date-count{font-size:11px;color:#2a2a2a;margin-top:3px}
.pitch-card{background:#0d0d0d;border:1px solid #1a1a1a;border-radius:14px;margin-bottom:28px;overflow:hidden}
.pitch-header{padding:22px 28px;border-bottom:1px solid #141414;display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.pitch-meta{flex:1}
.pitch-num{font-size:10px;font-weight:700;letter-spacing:0.1em;color:#2a2a2a;text-transform:uppercase;margin-bottom:5px}
.pitch-name{font-size:17px;font-weight:500;letter-spacing:-0.2px;margin-bottom:5px;color:#ddd}
.pitch-date{font-size:11px;color:#2e2e2e}
.badge{padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;letter-spacing:0.04em;white-space:nowrap;flex-shrink:0}
.badge-pending{background:#181200;color:#d4900a;border:1px solid #2a1f00}
.badge-approved{background:#0a180a;color:#3dba6e;border:1px solid #0f2e0f}
.badge-rejected{background:#180a0a;color:#c0524a;border:1px solid #2e0f0f}
.pitch-content{padding:28px 28px 20px;border-bottom:1px solid #141414}
.pitch-content h1,.pitch-content h2,.pitch-content h3{margin:20px 0 8px;color:#ccc}
.pitch-content h1{font-size:16px;font-weight:600;color:#ddd}
.pitch-content h2{font-size:15px;font-weight:600}
.pitch-content h3{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#555}
.pitch-content p,.pitch-content li{font-size:13px;color:#666;line-height:1.8;margin-bottom:8px}
.pitch-content strong{color:#aaa}
.pitch-content ul{margin:6px 0 12px 18px}
.pitch-content table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}
.pitch-content td{padding:8px 12px;border:1px solid #1e1e1e;color:#666}
.pitch-content tr:first-child td{color:#bbb;background:#111;font-weight:500}
.votes-panel{padding:20px 28px;border-bottom:1px solid #141414;background:#0a0a0a}
.panel-label{font-size:10px;font-weight:700;letter-spacing:0.1em;color:#2a2a2a;text-transform:uppercase;margin-bottom:14px}
.voter-row{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.chip{padding:5px 12px;border-radius:20px;font-size:11px;font-weight:600}
.chip-yes{background:#0a180a;color:#3dba6e;border:1px solid #0f2e0f}
.chip-no{background:#180a0a;color:#c0524a;border:1px solid #2e0f0f}
.chip-wait{background:#131313;color:#333;border:1px solid #1c1c1c}
.vote-stats{display:flex;gap:24px;margin-bottom:18px}
.stat{text-align:center}
.stat .n{font-size:24px;font-weight:300;display:block;margin-bottom:3px;letter-spacing:-0.5px}
.stat .lbl{font-size:10px;color:#2a2a2a;text-transform:uppercase;letter-spacing:0.08em;font-weight:600}
.stat.yes .n{color:#3dba6e}
.stat.no .n{color:#c0524a}
.stat.wait .n{color:#444}
.vote-actions{display:flex;gap:8px;flex-wrap:wrap}
.vbtn{padding:9px 22px;border-radius:8px;border:1px solid #1e1e1e;background:#131313;color:#555;font-size:13px;cursor:pointer;transition:all .15s;font-weight:500}
.vbtn:hover{background:#1a1a1a;color:#ccc;border-color:#2a2a2a}
.vbtn.active-yes{border-color:#0f2e0f;background:#0a180a;color:#3dba6e}
.vbtn.active-no{border-color:#2e0f0f;background:#180a0a;color:#c0524a}
.comments-panel{padding:20px 28px}
.comment{border-left:2px solid #181818;padding:8px 14px;margin-bottom:10px}
.comment-who{font-size:11px;color:#333;font-weight:600;margin-bottom:3px}
.comment-txt{font-size:13px;color:#666;line-height:1.6}
.cform{display:flex;gap:8px;margin-top:14px}
.cinput{flex:1;background:#131313;border:1px solid #1e1e1e;border-radius:8px;padding:10px 14px;color:#ccc;font-size:13px;outline:none;transition:border-color .15s}
.cinput:focus{border-color:#2a2a2a}
.csend{padding:10px 16px;background:#131313;border:1px solid #1e1e1e;border-radius:8px;color:#555;font-size:13px;cursor:pointer;transition:all .15s;white-space:nowrap}
.csend:hover{background:#1a1a1a;color:#ccc}
.admin-row{padding:14px 28px;border-top:1px solid #141414;display:flex;align-items:center;gap:10px;background:#080808}
.admin-tag{font-size:10px;color:#2a2a2a;text-transform:uppercase;letter-spacing:0.07em;flex:1}
.abtn{padding:8px 18px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;letter-spacing:0.03em;transition:all .15s}
.abtn-ok{background:#0a180a;border:1px solid #14380a;color:#3dba6e}
.abtn-ok:hover{background:#0f2000}
.abtn-no{background:#180a0a;border:1px solid #380a14;color:#c0524a}
.abtn-no:hover{background:#200a0a}
.empty{text-align:center;padding:80px 0}
.empty h2{font-size:18px;font-weight:300;margin-bottom:8px;color:#2a2a2a}
.empty p{font-size:13px;color:#1e1e1e}
.spin{display:inline-block;width:18px;height:18px;border:2px solid #1a1a1a;border-top-color:#2e2e2e;border-radius:50%;animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.toast{position:fixed;bottom:24px;right:24px;background:#141414;border:1px solid #222;border-radius:8px;padding:12px 18px;font-size:13px;color:#aaa;z-index:999;opacity:0;transform:translateY(4px);transition:all .25s}
.toast.on{opacity:1;transform:translateY(0)}
.status-filter{display:flex;gap:8px;padding:14px 32px;border-bottom:1px solid #141414;background:#080808;flex-wrap:wrap}
.sfilter{padding:6px 14px;background:#131313;border:1px solid #1e1e1e;border-radius:20px;color:#444;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;transition:all .15s}
.sfilter:hover{color:#aaa;border-color:#2a2a2a}
.sfilter.active{background:#1a1a1a;color:#ddd;border-color:#333}
.sfilter.pending.active{background:#181200;color:#d4900a;border-color:#2a1f00}
.sfilter.approved.active{background:#0a180a;color:#3dba6e;border-color:#0f2e0f}
.sfilter.rejected.active{background:#180a0a;color:#c0524a;border-color:#2e0f0f}
</style></head>
<body>
<div class="topbar">
  <div class="logo">App Factory &middot; <span>Board Room</span></div>
  <div class="userbadge">Voting as: <select class="user-select" id="user-select" onchange="changeUser(this.value)">
    <option value="Guest"${safeUser==='Guest'?' selected':''}>Guest</option>
    <option value="Cristian"${safeUser==='Cristian'?' selected':''}>Cristian</option>
    <option value="Andrew"${safeUser==='Andrew'?' selected':''}>Andrew</option>
    <option value="Justin"${safeUser==='Justin'?' selected':''}>Justin</option>
    <option value="Kausar"${safeUser==='Kausar'?' selected':''}>Kausar</option>
  </select></div>
</div>
<div class="tabs">
  <div class="tab active" data-tab="daily" onclick="switchTab('daily')">Daily Ideas</div>
  <div class="tab" data-tab="all" onclick="switchTab('all')">All Proposals</div>
</div>
<div class="status-filter">
  <button class="sfilter active" data-status="" onclick="setStatus('')">All</button>
  <button class="sfilter pending" data-status="pending" onclick="setStatus('pending')">Pending</button>
  <button class="sfilter approved" data-status="approved" onclick="setStatus('approved')">Approved</button>
  <button class="sfilter rejected" data-status="rejected" onclick="setStatus('rejected')">Rejected</button>
</div>
<main>
  <div id="section-daily">
    <h1 class="page-title">Daily B2B Ideas</h1>
    <p class="page-sub">5 researched global business ideas — generated every day at 8 AM. Vote and review each one Shark Tank style.</p>
    <div class="date-bar-wrap">
      <div class="date-bar" id="date-bar"><div class="dday">Loading...</div></div>
      <div class="cal-date-label" id="cal-label"></div>
      <div class="cal-date-count" id="cal-count"></div>
    </div>
    <div id="daily-app"><div class="empty"><div class="spin"></div></div></div>
  </div>

  <div id="section-all" style="display:none">
    <h1 class="page-title">All Proposals</h1>
    <p class="page-sub">Every pitch ever submitted to the Board Room, newest first.</p>
    <div id="all-app"><div class="empty"><div class="spin"></div></div></div>
  </div>
</main>
<div class="toast" id="toast"></div>
<script>
let ME = '${safeUser}';
let IS_ADMIN = ME === 'Cristian';

function changeUser(u) {
  ME = u;
  IS_ADMIN = ME === 'Cristian';
  const url = new URL(window.location.href);
  url.searchParams.set('user', u);
  window.history.replaceState({}, '', url.toString());
  activeTab === 'daily' ? renderDaily() : renderAll();
}
let currentDate = '${today}';
let activeTab = 'daily';
let activeStatus = '';
let availableDates = [];

function setStatus(s) {
  activeStatus = s;
  document.querySelectorAll('.sfilter').forEach(el => {
    el.classList.toggle('active', el.dataset.status === s);
  });
  activeTab === 'daily' ? renderDaily() : renderAll();
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('section-daily').style.display = tab === 'daily' ? '' : 'none';
  document.getElementById('section-all').style.display = tab === 'all' ? '' : 'none';
  if (tab === 'all') renderAll();
}

function fmtDateBtn(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date().toISOString().slice(0, 10);
  if (iso === today) return 'Today';
  return dt.toLocaleDateString('en-US', {month:'short', day:'numeric'});
}

async function loadDateBar() {
  availableDates = await api('/proposals/dates');
  const today = new Date().toISOString().slice(0, 10);
  // Ensure today is always in list (even if no proposals yet)
  if (!availableDates.includes(today)) availableDates = [today, ...availableDates];
  renderDateBar();
}

function renderDateBar() {
  const bar = document.getElementById('date-bar');
  const today = new Date().toISOString().slice(0, 10);
  let h = availableDates.map(d => {
    const isActive = d === currentDate;
    const isToday = d === today;
    return '<button class="dday' + (isActive ? ' active' : '') + (isToday ? ' today-badge' : '') + '" onclick="selectDate(\\'' + d + '\\')">' + fmtDateBtn(d) + '</button>';
  }).join('');
  // Calendar picker at the end
  h += '<div style="position:relative;flex-shrink:0">'
    + '<button class="dcal-btn" onclick="document.getElementById(\\'dcal\\').showPicker()" title="Pick date">&#128197;</button>'
    + '<input type="date" id="dcal" class="dcal-input" value="' + currentDate + '" onchange="calPick(this.value)">'
    + '</div>';
  bar.innerHTML = h;
  // Scroll active into view
  const active = bar.querySelector('.dday.active');
  if (active) active.scrollIntoView({inline:'center', behavior:'smooth', block:'nearest'});
  // Update label
  const [y, m, d] = currentDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  document.getElementById('cal-label').textContent = dt.toLocaleDateString('en-US', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
}

function selectDate(d) {
  currentDate = d;
  renderDateBar();
  renderDaily();
}

function calPick(d) {
  if (!d) return;
  currentDate = d;
  if (!availableDates.includes(d)) availableDates = [d, ...availableDates].sort().reverse();
  renderDateBar();
  renderDaily();
}

function toast(msg, ok) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderColor = ok === false ? '#5c1d1d' : '#1d5c1d';
  t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 3000);
}

async function api(url, method, body) {
  try {
    const r = await fetch(url, { method: method || 'GET', headers: {'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    try { return JSON.parse(text); } catch(e) { return []; }
  } catch(e) { return []; }
}

function chips(votes) {
  return ['Cristian','Andrew','Justin','Kausar'].map(u => {
    const v = votes.find(x => x.user === u);
    const c = v ? (v.decision === 'approve' ? 'chip-yes' : 'chip-no') : 'chip-wait';
    const ic = v ? (v.decision === 'approve' ? 'SI' : 'NO') : '&mdash;';
    return '<span class="chip ' + c + '">' + ic + ' ' + u + '</span>';
  }).join('');
}

function badge(s) {
  if (s === 'approved') return '<span class="badge badge-approved">&#10003; Approved</span>';
  if (s === 'rejected') return '<span class="badge badge-rejected">&#10007; Rejected</span>';
  return '<span class="badge badge-pending">Pending</span>';
}

function fdate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function pitchCard(p, index) {
  const vts = p.localVotes || [];
  const cmts = p.localComments || [];
  const yes = vts.filter(v => v.decision === 'approve').length;
  const no = vts.filter(v => v.decision === 'reject').length;
  const wait = 4 - yes - no;
  const mv = vts.find(v => v.user === ME);
  const isPending = p.status === 'pending';
  const aCls = 'vbtn' + (mv && mv.decision === 'approve' ? ' active-yes' : '');
  const rCls = 'vbtn' + (mv && mv.decision === 'reject' ? ' active-no' : '');
  let h = '<div class="pitch-card">';
  h += '<div class="pitch-header"><div class="pitch-meta">';
  if (index !== undefined) h += '<div class="pitch-num">Idea ' + (index + 1) + ' of 5</div>';
  h += '<div class="pitch-name">' + p.title + '</div>';
  h += '<div class="pitch-date">' + fdate(p.createdAt) + '</div>';
  h += '</div>' + badge(p.status) + '</div>';
  h += '<div class="pitch-content">' + p.contentHtml + '</div>';
  h += '<div class="votes-panel"><div class="panel-label">Board Votes</div>';
  h += '<div class="voter-row">' + chips(vts) + '</div>';
  h += '<div class="vote-stats">';
  h += '<div class="stat yes"><span class="n">' + yes + '</span><span class="lbl">For</span></div>';
  h += '<div class="stat no"><span class="n">' + no + '</span><span class="lbl">Against</span></div>';
  h += '<div class="stat wait"><span class="n">' + wait + '</span><span class="lbl">Pending</span></div>';
  h += '</div>';
  if (isPending) {
    h += '<div class="vote-actions">';
    h += '<button class="' + aCls + '" data-action="approve" data-id="' + p.id + '">Approve</button>';
    h += '<button class="' + rCls + '" data-action="reject" data-id="' + p.id + '">Reject</button>';
    h += '</div>';
  }
  h += '</div>';
  h += '<div class="comments-panel"><div class="panel-label">Comments</div>';
  if (cmts.length) {
    cmts.forEach(c => {
      h += '<div class="comment"><div class="comment-who">' + c.user + '</div><div class="comment-txt">' + c.text + '</div></div>';
    });
  } else {
    h += '<p style="font-size:13px;color:#222;margin-bottom:12px">No comments yet.</p>';
  }
  if (isPending) {
    h += '<div class="cform"><input class="cinput" data-comment-id="' + p.id + '" placeholder="Your comment...">';
    h += '<button class="csend" data-action="comment" data-id="' + p.id + '">Send</button></div>';
  }
  h += '</div>';
  if (IS_ADMIN && isPending) {
    h += '<div class="admin-row"><span class="admin-tag">Admin Override</span>';
    h += '<button class="abtn abtn-ok" data-action="admin-approve" data-id="' + p.id + '">Approve &amp; Proceed</button>';
    h += '<button class="abtn abtn-no" data-action="admin-reject" data-id="' + p.id + '">Reject</button></div>';
  }
  h += '</div>';
  return h;
}

async function renderDaily() {
  const el = document.getElementById('daily-app');
  el.innerHTML = '<div class="empty"><div class="spin"></div></div>';
  const [y, m, d] = currentDate.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday = currentDate === todayStr;
  try {
    const data = await api('/proposals/by-date?date=' + currentDate + (activeStatus ? '&status=' + activeStatus : ''));
    document.getElementById('cal-count').textContent = Array.isArray(data) && data.length ? data.length + ' idea' + (data.length !== 1 ? 's' : '') + ' this day' : 'No ideas this day';
    if (!Array.isArray(data) || !data.length) {
      el.innerHTML = '<div class="empty"><h2>No ideas for this day</h2><p>The Researcher generates 5 B2B ideas every day at 8 AM.</p></div>';
      return;
    }
    el.innerHTML = data.map((p, i) => pitchCard(p, i)).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty"><h2>Error loading</h2><p>' + e.message + '</p></div>';
  }
}

async function renderAll() {
  const el = document.getElementById('all-app');
  el.innerHTML = '<div class="empty"><div class="spin"></div></div>';
  try {
    const data = await api('/proposals' + (activeStatus ? '?status=' + activeStatus : ''));
    if (!Array.isArray(data) || !data.length) {
      el.innerHTML = '<div class="empty"><h2>No proposals yet</h2><p>The CEO has not submitted any pitches yet.</p></div>';
      return;
    }
    el.innerHTML = data.map(p => pitchCard(p)).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty"><h2>Error loading</h2><p>' + e.message + '</p></div>';
  }
}

document.addEventListener('click', async function(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action, id = btn.dataset.id;
  if (action === 'approve' || action === 'reject') {
    await api('/vote', 'POST', {approvalId: id, user: ME, decision: action});
    toast(action === 'approve' ? 'Voted: Approve' : 'Voted: Reject');
    activeTab === 'daily' ? renderDaily() : renderAll();
  }
  if (action === 'admin-approve' || action === 'admin-reject') {
    const dec = action === 'admin-approve' ? 'approve' : 'reject';
    if (!confirm(dec === 'approve' ? 'Approve and notify CEO to proceed?' : 'Reject this proposal?')) return;
    const r = await api('/admin/decide', 'POST', {approvalId: id, decision: dec});
    toast(r.ok ? (dec === 'approve' ? 'Approved. CEO will proceed.' : 'Rejected.') : 'Error: ' + (r.error || ''), r.ok);
    activeTab === 'daily' ? renderDaily() : renderAll();
  }
  if (action === 'comment') {
    const inp = document.querySelector('[data-comment-id="' + id + '"]');
    if (!inp || !inp.value.trim()) return;
    await api('/comment', 'POST', {approvalId: id, user: ME, text: inp.value.trim()});
    inp.value = '';
    toast('Comment sent');
    activeTab === 'daily' ? renderDaily() : renderAll();
  }
});

document.addEventListener('keydown', async function(e) {
  if (e.key !== 'Enter') return;
  const inp = e.target.closest('[data-comment-id]');
  if (!inp || !inp.value.trim()) return;
  const id = inp.dataset.commentId;
  await api('/comment', 'POST', {approvalId: id, user: ME, text: inp.value.trim()});
  inp.value = '';
  toast('Comment sent');
  activeTab === 'daily' ? renderDaily() : renderAll();
});

loadDateBar().then(() => renderDaily());
</script>
</body></html>`;
}

app.get('/', (req, res) => {
  const user = req.query.user;
  if (!user || !USERS.includes(user)) return res.send(loginHtml());
  res.send(mainHtml(user));
});

app.get('/proposals', async (req, res) => {
  try {
    const status = req.query.status; // 'approved' | 'pending' | 'rejected' | undefined
    const approvals = await paperclipGet('/companies/' + COMPANY_ID + '/approvals');
    const votes = await loadVotes();
    let list = buildProposalList(approvals, votes);
    if (status) list = list.filter(p => p.status === status);
    res.json(list);
  } catch (e) { res.json([]); }
});

app.get('/proposals/dates', async (req, res) => {
  try {
    const approvals = await paperclipGet('/companies/' + COMPANY_ID + '/approvals');
    const all = buildProposalList(approvals, {});
    const dates = [...new Set(all.map(p => p.createdAt && p.createdAt.slice(0, 10)).filter(Boolean))].sort().reverse();
    res.json(dates);
  } catch (e) { res.json([]); }
});

app.get('/proposals/by-date', async (req, res) => {
  try {
    const date = req.query.date;
    const status = req.query.status;
    if (!date) return res.json([]);
    const approvals = await paperclipGet('/companies/' + COMPANY_ID + '/approvals');
    const votes = await loadVotes();
    let all = buildProposalList(approvals, votes);
    all = all.filter(p => p.createdAt && p.createdAt.slice(0, 10) === date);
    if (status) all = all.filter(p => p.status === status);
    res.json(all);
  } catch (e) { res.json([]); }
});

app.post('/vote', async (req, res) => {
  const { approvalId, user, decision } = req.body;
  if (!approvalId || !user || (decision !== 'approve' && decision !== 'reject')) return res.json({ ok: false });
  const votes = await loadVotes();
  if (!votes[approvalId]) votes[approvalId] = { votes: [], comments: [] };
  votes[approvalId].votes = votes[approvalId].votes.filter(v => v.user !== user);
  votes[approvalId].votes.push({ user, decision, at: new Date().toISOString() });
  await saveVotes(votes);
  res.json({ ok: true });
});

app.post('/comment', async (req, res) => {
  const { approvalId, user, text } = req.body;
  if (!approvalId || !user || !text) return res.json({ ok: false });
  const votes = await loadVotes();
  if (!votes[approvalId]) votes[approvalId] = { votes: [], comments: [] };
  votes[approvalId].comments.push({ user, text, at: new Date().toISOString() });
  await saveVotes(votes);
  res.json({ ok: true });
});

app.post('/admin/decide', async (req, res) => {
  const { approvalId, decision } = req.body;
  if (!approvalId || (decision !== 'approve' && decision !== 'reject')) return res.json({ ok: false, error: 'Invalid' });
  try {
    const votes = await loadVotes();
    const vData = (votes[approvalId] || { votes: [] });
    const note = vData.votes.map(v => v.user + ': ' + v.decision).join(', ') || 'Board decision via Boardroom';
    const realId = approvalId.includes('__pitch') ? approvalId.split('__pitch')[0] : approvalId;
    const result = await paperclipPost('/approvals/' + realId + '/' + decision, { note });
    if (result && result.error) return res.json({ ok: false, error: result.error });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, '127.0.0.1', () => console.log('Board Room running on port ' + PORT));
}

module.exports = app;
