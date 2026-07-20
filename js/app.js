/* ============================================================
   APP CONTROLLER
   Navigation, settings (localStorage), dashboard, watchlist,
   history, risk calculator UI, TradingView embed, export.
   ============================================================ */
'use strict';

const App = (() => {
  const $ = id => document.getElementById(id);
  const SETTINGS_KEY = 'ai_trader_settings';
  let analysesCache = [];
  let watchlistCache = [];
  let perfChart = null;

  // ---------------- settings ----------------
  function getSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

  function loadSettingsUI() {
    const s = getSettings();
    $('set-api-key').value = s.apiKey || '';
    $('set-model').value = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'].includes(s.model) ? s.model : (s.model ? 'custom' : 'gemini-2.5-flash');
    $('set-custom-model').value = s.customModel || '';
    $('custom-model-group').style.display = $('set-model').value === 'custom' ? '' : 'none';
    $('set-fallback').value = s.fallback !== undefined ? s.fallback : 'gemini-2.5-flash-lite';
    $('set-balance').value = s.balance || '';
    $('set-risk').value = s.risk || '1';
    $('set-max-daily').value = s.maxDaily || 3;
    $('set-min-rr').value = s.minRR || 2;
    $('set-name').value = s.name || '';
    $('set-strict').checked = s.strict !== false;
    $('set-coach').checked = s.coach !== false;
    updateModelBadge();
  }

  function collectSettings() {
    const modelSel = $('set-model').value;
    return {
      apiKey: $('set-api-key').value.trim(),
      model: modelSel === 'custom' ? 'custom' : modelSel,
      customModel: $('set-custom-model').value.trim(),
      fallback: $('set-fallback').value,
      balance: parseFloat($('set-balance').value) || null,
      risk: parseFloat($('set-risk').value) || 1,
      maxDaily: parseFloat($('set-max-daily').value) || 3,
      minRR: parseFloat($('set-min-rr').value) || 2,
      name: $('set-name').value.trim(),
      strict: $('set-strict').checked,
      coach: $('set-coach').checked
    };
  }

  function updateModelBadge() {
    $('model-badge').textContent = Gemini.primaryModel();
    setAiStatus(Gemini.hasKey() ? 'connected' : 'disconnected');
  }

  // ---------------- AI status ----------------
  function setAiStatus(state) {
    const el = $('ai-status');
    el.className = 'ai-status ' + state;
    $('ai-status-text').textContent = {
      connected: 'متصل (Connected)',
      disconnected: 'غير متصل — أضف API Key',
      thinking: 'بيفكر... (Analyzing)'
    }[state] || state;
  }

  // ---------------- toast ----------------
  function toast(msg, type = 'ok') {
    const icons = { ok: 'fa-circle-check', err: 'fa-circle-xmark', warn: 'fa-triangle-exclamation' };
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.innerHTML = `<i class="fa-solid ${icons[type] || icons.ok}"></i><span>${msg}</span>`;
    $('toast-container').appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 3500);
  }

  // ---------------- navigation ----------------
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    const view = $('view-' + name);
    if (view) view.classList.add('active');
    // close mobile sidebar
    $('sidebar').classList.remove('open');
    $('sidebar-overlay').classList.remove('show');
    if (name === 'dashboard') refreshDashboard();
    if (name === 'history') renderHistory();
    if (name === 'watchlist') renderWatchlist();
    if (name === 'tradingview' && !tvLoaded) loadTradingView();
  }

  // ---------------- analyses ----------------
  async function loadAnalyses() {
    try {
      const res = await fetch('tables/analyses?limit=500&sort=-created_at');
      const json = await res.json();
      analysesCache = (json.data || []).filter(a => !a.deleted);
    } catch { analysesCache = []; }
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function decisionBadge(d) {
    const dd = (d || '').toUpperCase();
    const cls = dd.includes('BUY') ? 'buy' : dd.includes('SELL') ? 'sell' : dd === 'WAIT' ? 'pending' : 'none';
    return `<span class="badge ${cls}">${esc(d || '—')}</span>`;
  }

  function renderHistory() {
    const q = ($('history-search').value || '').toUpperCase();
    const f = $('history-filter').value;
    const rows = analysesCache.filter(a =>
      (!q || (a.market || '').toUpperCase().includes(q) || (a.decision || '').includes(q)) &&
      (!f || a.decision === f));
    $('history-list').innerHTML = rows.map(a => {
      const date = a.created_at ? new Date(a.created_at).toLocaleString('ar-EG') : '';
      const conf = a.confidence != null ? a.confidence + '%' : '—';
      return `<div class="history-item" data-id="${a.id}">
        <div class="h-main">
          <span class="sym">${esc(a.market)}</span>
          ${decisionBadge(a.decision)}
          <span class="h-conf">${conf}</span>
          <span class="badge none">v${a.version || 1}</span>
        </div>
        <div class="h-meta">${esc(a.model_used || '')} · ${date}</div>
      </div>`;
    }).join('');
    $('history-empty').classList.toggle('show', rows.length === 0);
  }

  function openAnalysisModal(a) {
    $('analysis-modal-title').textContent = `${a.market} — ${a.decision} (v${a.version || 1})`;
    const body = $('analysis-modal-body');
    body.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;align-items:center">
        ${decisionBadge(a.decision)}
        <span class="badge none">الثقة: ${a.confidence ?? '—'}%</span>
        <span class="badge ${a.bias === 'Bullish' ? 'buy' : a.bias === 'Bearish' ? 'sell' : 'none'}">${esc(a.bias || '')}</span>
        ${a.risk_reward ? `<span class="badge none">RR ${esc(a.risk_reward)}</span>` : ''}
        <button class="btn-secondary btn-sm" id="continue-analysis-btn"><i class="fa-solid fa-rotate-right"></i> استكمال / تحديث</button>
      </div>
      <div class="msg-md">${marked.parse(a.summary || '')}</div>`;
    $('analysis-modal').hidden = false;
    $('continue-analysis-btn').addEventListener('click', () => {
      $('analysis-modal').hidden = true;
      Analysis.continueFrom(a);
    });
  }

  // ---------------- watchlist ----------------
  async function loadWatchlist() {
    try {
      const res = await fetch('tables/watchlist?limit=200&sort=-updated_at');
      const json = await res.json();
      watchlistCache = (json.data || []).filter(w => !w.deleted);
    } catch { watchlistCache = []; }
  }

  function renderWatchlist() {
    const grid = $('watchlist-grid');
    grid.innerHTML = watchlistCache.map(w => {
      const biasCls = w.bias === 'Bullish' ? 'buy' : w.bias === 'Bearish' ? 'sell' : 'none';
      const biasAr = { Bullish: 'صاعد (Bullish)', Bearish: 'هابط (Bearish)', Neutral: 'محايد (Neutral)' }[w.bias] || '—';
      return `<div class="wl-card">
        <button class="icon-btn danger" data-del="${w.id}" aria-label="حذف"><i class="fa-solid fa-trash"></i></button>
        <div class="sym">${esc(w.symbol)}</div>
        <div class="wl-bias"><span class="badge ${biasCls}">${biasAr}</span>
          ${w.confidence != null ? `<span class="badge none">${w.confidence}%</span>` : ''}</div>
        <div class="wl-meta">${w.updated_at ? 'آخر تحديث: ' + new Date(w.updated_at).toLocaleString('ar-EG') : 'لم يُحلل بعد'}</div>
      </div>`;
    }).join('');
    $('watchlist-empty').classList.toggle('show', watchlistCache.length === 0);
    renderDashWatchlist();
  }

  async function addWatchSymbol() {
    const sym = $('wl-symbol').value.trim().toUpperCase();
    if (!sym) return;
    if (watchlistCache.some(w => w.symbol === sym)) { toast('الرمز موجود بالفعل', 'warn'); return; }
    try {
      await fetch('tables/watchlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, bias: 'Neutral', trend: '', notes: '' })
      });
      $('wl-symbol').value = '';
      await loadWatchlist(); renderWatchlist();
      toast(`تمت إضافة ${sym} ⭐`, 'ok');
    } catch { toast('فشل الإضافة', 'err'); }
  }

  // ---------------- dashboard ----------------
  function renderDashWatchlist() {
    const el = $('dash-watchlist');
    if (!watchlistCache.length) { el.innerHTML = '<p class="empty-msg show">أضف رموز للمتابعة</p>'; return; }
    el.innerHTML = watchlistCache.slice(0, 6).map(w => {
      const biasCls = w.bias === 'Bullish' ? 'buy' : w.bias === 'Bearish' ? 'sell' : 'none';
      return `<div class="mini-item"><span class="sym">${esc(w.symbol)}</span>
        <span class="badge ${biasCls}">${esc(w.bias || '—')}${w.confidence != null ? ' · ' + w.confidence + '%' : ''}</span></div>`;
    }).join('');
  }

  function refreshDashboard() {
    const s = getSettings();
    const trades = Trades.getCache();
    const closed = trades.filter(t => t.status === 'CLOSED' && t.result && t.result !== 'NONE');
    const wins = closed.filter(t => t.result === 'WIN').length;
    const losses = closed.filter(t => t.result === 'LOSS').length;
    const winRate = (wins + losses) ? Math.round(wins / (wins + losses) * 100) : null;

    $('stat-balance').textContent = s.balance ? '$' + Number(s.balance).toLocaleString() : '—';
    $('stat-winrate').textContent = winRate != null ? winRate + '%' : '—';

    // avg RR from closed trades that have rr like "1:2.5"
    const rrs = closed.map(t => parseFloat((t.risk_reward || '').split(':')[1])).filter(v => !isNaN(v));
    $('stat-avg-rr').textContent = rrs.length ? '1:' + (rrs.reduce((a, b) => a + b, 0) / rrs.length).toFixed(1) : '—';

    // open risk estimate
    const open = Trades.openTrades();
    $('stat-open-risk').textContent = open.length ? open.length + ' صفقة' : '0';

    // open trades list
    const otEl = $('dash-open-trades');
    otEl.innerHTML = open.length ? open.slice(0, 6).map(t =>
      `<div class="mini-item"><span class="sym">${esc(t.market)}</span>
       <span><span class="badge ${t.direction === 'BUY' ? 'buy' : 'sell'}">${t.direction}</span>
       <span class="badge ${(t.status || '').toLowerCase()}">${t.status === 'OPEN' ? 'مفتوحة' : 'معلقة'}</span></span></div>`).join('')
      : '<p class="empty-msg show">لا توجد صفقات مفتوحة</p>';

    // latest analyses
    const laEl = $('dash-latest-analyses');
    laEl.innerHTML = analysesCache.length ? analysesCache.slice(0, 6).map(a =>
      `<div class="mini-item" style="cursor:pointer" data-aid="${a.id}">
        <span class="sym">${esc(a.market)}</span>
        <span>${decisionBadge(a.decision)} <span class="badge none">${a.confidence ?? '—'}%</span></span>
      </div>`).join('')
      : '<p class="empty-msg show">لا توجد تحليلات بعد</p>';

    renderDashWatchlist();
    renderRiskDashboard(closed, open, s);
    renderPerfChart(closed);
  }

  function renderRiskDashboard(closed, open, s) {
    const today = new Date().toDateString();
    const todayClosed = closed.filter(t => t.closed_at && new Date(t.closed_at).toDateString() === today);
    const todayPnl = todayClosed.reduce((a, t) => a + (t.pnl || 0), 0);
    const totalPnl = closed.reduce((a, t) => a + (t.pnl || 0), 0);
    const maxDailyLoss = s.balance && s.maxDaily ? s.balance * s.maxDaily / 100 : null;
    const dailyState = maxDailyLoss && todayPnl < 0
      ? (Math.abs(todayPnl) >= maxDailyLoss ? 'danger' : Math.abs(todayPnl) >= maxDailyLoss * 0.6 ? 'warn' : 'safe')
      : 'safe';

    const items = [
      { lbl: 'ربح/خسارة اليوم', val: (todayPnl >= 0 ? '+' : '') + todayPnl.toFixed(2) + '$', cls: todayPnl >= 0 ? 'safe' : dailyState },
      { lbl: 'إجمالي P/L', val: (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2) + '$', cls: totalPnl >= 0 ? 'safe' : 'warn' },
      { lbl: 'الصفقات المفتوحة', val: String(open.length), cls: open.length > 3 ? 'warn' : 'safe' },
      { lbl: 'حد الخسارة اليومي', val: maxDailyLoss ? maxDailyLoss.toFixed(0) + '$' : '—', cls: 'safe' },
      { lbl: 'المخاطرة الافتراضية', val: (s.risk || 1) + '%', cls: (s.risk || 1) > 2 ? 'warn' : 'safe' },
      { lbl: 'الوضع', val: dailyState === 'danger' ? '🛑 أوقف التداول' : dailyState === 'warn' ? '⚠️ حذر' : '✅ آمن', cls: dailyState }
    ];
    $('risk-dashboard-body').innerHTML = items.map(i =>
      `<div class="risk-dash-item ${i.cls}"><span class="lbl">${i.lbl}</span><span class="val">${i.val}</span></div>`).join('');
  }

  function renderPerfChart(closed) {
    const ctx = $('performance-chart');
    if (!ctx) return;
    // cumulative pnl over closed trades (chronological)
    const sorted = closed.slice().sort((a, b) => (a.closed_at || 0) - (b.closed_at || 0));
    let cum = 0;
    const points = sorted.map(t => { cum += (t.pnl || 0); return cum; });
    const labels = sorted.map((t, i) => '#' + (i + 1));
    if (perfChart) perfChart.destroy();
    perfChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels.length ? labels : ['—'],
        datasets: [{
          label: 'الأداء التراكمي ($)',
          data: points.length ? points : [0],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,.12)',
          fill: true, tension: .35, pointRadius: 3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#8b96ab' } } },
        scales: {
          x: { ticks: { color: '#8b96ab' }, grid: { color: 'rgba(255,255,255,.05)' } },
          y: { ticks: { color: '#8b96ab' }, grid: { color: 'rgba(255,255,255,.05)' } }
        }
      }
    });
  }

  // ---------------- risk calculator UI ----------------
  function runRiskCalc() {
    const num = id => { const v = $(id).value; return v === '' ? null : parseFloat(v); };
    const s = getSettings();
    const result = RiskEngine.calculate({
      market: $('rc-market').value,
      balance: num('rc-balance') ?? s.balance,
      riskPct: num('rc-risk'),
      entry: num('rc-entry'), sl: num('rc-sl'),
      tp1: num('rc-tp1'), tp2: num('rc-tp2'), tp3: num('rc-tp3'),
      customPipSize: num('rc-pip-size'), customPipValue: num('rc-pip-value'),
      minRR: s.minRR || 2
    });
    const el = $('rc-results');
    if (result.errors) {
      el.innerHTML = `<div class="rc-alert danger"><i class="fa-solid fa-circle-xmark"></i><div>${result.errors.join('<br>')}</div></div>`;
      return;
    }
    let html = `
      <div class="rc-result-item wide"><span class="lbl">حجم العقد (Lot Size)</span>
        <span class="val ${result.lotRaw < 0.01 ? 'red' : 'green'}">${result.lot.toFixed(2)}</span></div>
      <div class="rc-result-item"><span class="lbl">الاتجاه</span>
        <span class="val ${result.direction === 'BUY' ? 'green' : 'red'}">${result.direction === 'BUY' ? 'شراء' : 'بيع'} (${result.direction})</span></div>
      <div class="rc-result-item"><span class="lbl">مسافة الوقف (SL Pips)</span><span class="val">${result.slPips.toFixed(1)}</span></div>
      <div class="rc-result-item"><span class="lbl">المخاطرة المطلوبة</span><span class="val amber">$${result.riskAmount.toFixed(2)}</span></div>
      <div class="rc-result-item"><span class="lbl">المخاطرة الفعلية</span><span class="val ${result.actualRisk > result.riskAmount * 1.1 ? 'red' : ''}">$${result.actualRisk.toFixed(2)}</span></div>`;
    result.tps.forEach(t => {
      html += `<div class="rc-result-item"><span class="lbl">TP${t.n} — ربح متوقع (RR 1:${t.rr.toFixed(1)})</span>
        <span class="val green">+$${t.profit.toFixed(2)}</span></div>`;
    });
    if (result.approx) html += `<div class="rc-alert warn"><i class="fa-solid fa-circle-info"></i>قيمة النقطة تقريبية لهذا الزوج — راجع مواصفات وسيطك للدقة الكاملة.</div>`;
    if (result.rrStatus) html += `<div class="rc-alert ${result.rrStatus.ok ? 'ok' : 'danger'}"><i class="fa-solid ${result.rrStatus.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>${result.rrStatus.text}</div>`;
    result.warnings.forEach(w => { html += `<div class="rc-alert warn"><i class="fa-solid fa-triangle-exclamation"></i>${w}</div>`; });
    el.innerHTML = html;
  }

  // ---------------- TradingView ----------------
  let tvLoaded = false;
  function loadTradingView() {
    const symbol = $('tv-symbol').value.trim() || 'OANDA:XAUUSD';
    const interval = $('tv-interval').value;
    const container = $('tv-container');
    container.innerHTML = '';
    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container';
    widgetDiv.style.height = '100%';
    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.height = '100%';
    widgetDiv.appendChild(inner);
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true, symbol, interval, timezone: 'Etc/UTC',
      theme: 'dark', style: '1', locale: 'ar_AE',
      allow_symbol_change: true, support_host: 'https://www.tradingview.com'
    });
    widgetDiv.appendChild(script);
    container.appendChild(widgetDiv);
    tvLoaded = true;
  }

  // ---------------- export ----------------
  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportJson() {
    const data = {
      exported_at: new Date().toISOString(),
      settings: (() => { const s = getSettings(); delete s.apiKey; return s; })(),
      trades: Trades.getCache(),
      analyses: analysesCache,
      watchlist: watchlistCache
    };
    download('ai-trader-export.json', JSON.stringify(data, null, 2), 'application/json');
    toast('تم التصدير 📦', 'ok');
  }

  function exportCsv() {
    const trades = Trades.getCache();
    const cols = ['market', 'direction', 'order_type', 'entry', 'stop_loss', 'tp1', 'tp2', 'tp3', 'lot_size', 'risk_reward', 'status', 'result', 'pnl'];
    const csv = [cols.join(',')].concat(trades.map(t =>
      cols.map(c => JSON.stringify(t[c] ?? '')).join(','))).join('\n');
    download('trades.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
    toast('تم تصدير الصفقات 📄', 'ok');
  }

  // ---------------- bindings ----------------
  function bind() {
    // nav
    document.querySelectorAll('.nav-item').forEach(btn =>
      btn.addEventListener('click', () => showView(btn.dataset.view)));
    $('menu-toggle').addEventListener('click', () => {
      $('sidebar').classList.add('open');
      $('sidebar-overlay').classList.add('show');
    });
    $('sidebar-overlay').addEventListener('click', () => {
      $('sidebar').classList.remove('open');
      $('sidebar-overlay').classList.remove('show');
    });

    // modals close
    document.querySelectorAll('[data-close]').forEach(btn =>
      btn.addEventListener('click', () => { $(btn.dataset.close).hidden = true; }));
    document.querySelectorAll('.modal-backdrop').forEach(bd =>
      bd.addEventListener('click', e => { if (e.target === bd) bd.hidden = true; }));

    // settings
    $('set-model').addEventListener('change', () => {
      $('custom-model-group').style.display = $('set-model').value === 'custom' ? '' : 'none';
    });
    $('toggle-key-btn').addEventListener('click', () => {
      const inp = $('set-api-key');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      $('toggle-key-btn').innerHTML = `<i class="fa-solid ${inp.type === 'password' ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
    });
    $('save-settings-btn').addEventListener('click', () => {
      saveSettings(collectSettings());
      updateModelBadge();
      refreshDashboard();
      const msg = $('settings-saved-msg');
      msg.textContent = '✅ تم الحفظ'; msg.className = 'inline-msg ok';
      setTimeout(() => msg.textContent = '', 2500);
      toast('تم حفظ الإعدادات ✅', 'ok');
    });
    $('delete-key-btn').addEventListener('click', () => {
      if (!confirm('حذف مفتاح API؟')) return;
      const s = getSettings(); delete s.apiKey; saveSettings(s);
      $('set-api-key').value = '';
      updateModelBadge();
      toast('تم حذف المفتاح', 'ok');
    });
    $('test-api-btn').addEventListener('click', async () => {
      saveSettings(collectSettings());
      updateModelBadge();
      const msg = $('api-test-result');
      if (!Gemini.hasKey()) { msg.textContent = '❌ أدخل مفتاح API أولاً'; msg.className = 'inline-msg err'; return; }
      msg.textContent = '⏳ جاري الاختبار...'; msg.className = 'inline-msg';
      setAiStatus('thinking');
      try {
        const r = await Gemini.testConnection();
        msg.textContent = `✅ متصل بنجاح — الموديل: ${r.model}`; msg.className = 'inline-msg ok';
        setAiStatus('connected');
      } catch (e) {
        msg.textContent = '❌ ' + e.message; msg.className = 'inline-msg err';
        setAiStatus('disconnected');
      }
    });

    // watchlist
    $('wl-add-btn').addEventListener('click', addWatchSymbol);
    $('wl-symbol').addEventListener('keydown', e => { if (e.key === 'Enter') addWatchSymbol(); });
    $('watchlist-grid').addEventListener('click', async e => {
      const del = e.target.closest('[data-del]');
      if (del && confirm('حذف الرمز من المتابعة؟')) {
        await fetch(`tables/watchlist/${del.dataset.del}`, { method: 'DELETE' });
        await loadWatchlist(); renderWatchlist();
      }
    });

    // history
    $('history-search').addEventListener('input', renderHistory);
    $('history-filter').addEventListener('change', renderHistory);
    $('history-list').addEventListener('click', e => {
      const item = e.target.closest('.history-item');
      if (item) {
        const a = analysesCache.find(x => x.id === item.dataset.id);
        if (a) openAnalysisModal(a);
      }
    });
    $('dash-latest-analyses').addEventListener('click', e => {
      const item = e.target.closest('[data-aid]');
      if (item) {
        const a = analysesCache.find(x => x.id === item.dataset.aid);
        if (a) openAnalysisModal(a);
      }
    });

    // risk calc
    $('rc-calc-btn').addEventListener('click', runRiskCalc);
    $('rc-market').addEventListener('change', () => {
      $('rc-custom-fields').style.display = $('rc-market').value === 'CUSTOM' ? '' : 'none';
    });

    // TV
    $('tv-load-btn').addEventListener('click', loadTradingView);

    // export
    $('export-json-btn').addEventListener('click', exportJson);
    $('export-csv-btn').addEventListener('click', exportCsv);
  }

  // ---------------- init ----------------
  async function init() {
    marked.setOptions({ breaks: true, gfm: true });
    bind();
    loadSettingsUI();
    Analysis.init();
    await Promise.all([Trades.init(), Journal.init(), loadAnalyses(), loadWatchlist()]);
    renderWatchlist();
    renderHistory();
    refreshDashboard();
    // prefill risk calc balance
    const s = getSettings();
    if (s.balance) $('rc-balance').value = s.balance;
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    toast, showView, setAiStatus, getSettings, refreshDashboard,
    loadAnalyses, renderWatchlist,
    get analysesCache() { return analysesCache; }
  };
})();
