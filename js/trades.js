/* ============================================================
   TRADE MANAGER — CRUD via RESTful Table API (tables/trades)
   ============================================================ */
'use strict';

const Trades = (() => {
  let cache = [];

  async function loadAll() {
    try {
      const res = await fetch('tables/trades?limit=500&sort=-created_at');
      const json = await res.json();
      cache = (json.data || []).filter(t => !t.deleted);
    } catch { cache = []; }
    return cache;
  }

  function getCache() { return cache; }
  function openTrades() { return cache.filter(t => t.status === 'OPEN' || t.status === 'PENDING'); }

  async function save(data) {
    const method = data.id ? 'PUT' : 'POST';
    const url = data.id ? `tables/trades/${data.id}` : 'tables/trades';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('فشل حفظ الصفقة.');
    return res.json();
  }

  async function remove(id) {
    await fetch(`tables/trades/${id}`, { method: 'DELETE' });
  }

  // ---------- UI ----------
  const tbody = () => document.getElementById('trades-tbody');

  function fmt(n) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n); }

  function render() {
    const q = (document.getElementById('trades-search').value || '').toUpperCase();
    const f = document.getElementById('trades-filter').value;
    const rows = cache.filter(t =>
      (!q || (t.market || '').toUpperCase().includes(q)) && (!f || t.status === f));

    const body = tbody();
    body.innerHTML = rows.map(t => {
      const tps = [t.tp1, t.tp2, t.tp3].filter(x => x !== null && x !== undefined && x !== '').join(' / ') || '—';
      const pnl = t.pnl ? `<span class="${t.pnl > 0 ? 'pnl-pos' : 'pnl-neg'}">${t.pnl > 0 ? '+' : ''}${t.pnl}</span>` : '—';
      const statusAr = { OPEN: 'مفتوحة', PENDING: 'معلقة', CLOSED: 'مغلقة', CANCELLED: 'ملغاة' }[t.status] || t.status;
      const resAr = { WIN: 'ربح', LOSS: 'خسارة', BREAKEVEN: 'تعادل', NONE: '—' }[t.result || 'NONE'];
      return `<tr>
        <td><b>${t.market || ''}</b></td>
        <td><span class="badge ${t.direction === 'BUY' ? 'buy' : 'sell'}">${t.direction}</span></td>
        <td>${fmt(t.entry)}</td><td>${fmt(t.stop_loss)}</td><td>${tps}</td>
        <td>${fmt(t.lot_size)}</td><td>${t.risk_reward || '—'}</td>
        <td><span class="badge ${(t.status || '').toLowerCase()}">${statusAr}</span></td>
        <td><span class="badge ${(t.result || 'none').toLowerCase()}">${resAr}</span></td>
        <td>${pnl}</td>
        <td>
          <button class="icon-btn" data-edit="${t.id}" title="تعديل"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn danger" data-del="${t.id}" title="حذف"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
    document.getElementById('trades-empty').classList.toggle('show', rows.length === 0);
  }

  function openModal(trade) {
    const m = document.getElementById('trade-modal');
    document.getElementById('trade-modal-title').textContent = trade ? 'تعديل صفقة' : 'صفقة جديدة';
    const g = id => document.getElementById(id);
    g('tm-id').value = trade ? trade.id : '';
    g('tm-market').value = trade ? (trade.market || '') : '';
    g('tm-direction').value = trade ? (trade.direction || 'BUY') : 'BUY';
    g('tm-order-type').value = trade ? (trade.order_type || 'MARKET') : 'MARKET';
    ['entry', 'sl', 'lot', 'tp1', 'tp2', 'tp3', 'pnl'].forEach(k => {
      const map = { entry: 'entry', sl: 'stop_loss', lot: 'lot_size', tp1: 'tp1', tp2: 'tp2', tp3: 'tp3', pnl: 'pnl' };
      g('tm-' + k).value = trade && trade[map[k]] != null ? trade[map[k]] : '';
    });
    g('tm-status').value = trade ? (trade.status || 'OPEN') : 'OPEN';
    g('tm-result').value = trade ? (trade.result || 'NONE') : 'NONE';
    g('tm-notes').value = trade ? (trade.notes || '') : '';
    m.hidden = false;
  }

  async function saveFromModal() {
    const g = id => document.getElementById(id);
    const num = id => { const v = g(id).value; return v === '' ? null : parseFloat(v); };
    const market = g('tm-market').value.trim().toUpperCase();
    if (!market) { App.toast('أدخل السوق أولاً', 'warn'); return; }
    const entry = num('tm-entry'), sl = num('tm-sl'), tp1 = num('tm-tp1');
    let rr = '';
    if (entry != null && sl != null && tp1 != null && entry !== sl) {
      rr = '1:' + (Math.abs(tp1 - entry) / Math.abs(entry - sl)).toFixed(1);
    }
    const data = {
      market, direction: g('tm-direction').value, order_type: g('tm-order-type').value,
      entry, stop_loss: sl, tp1, tp2: num('tm-tp2'), tp3: num('tm-tp3'),
      lot_size: num('tm-lot'), pnl: num('tm-pnl'), risk_reward: rr,
      status: g('tm-status').value, result: g('tm-result').value,
      notes: g('tm-notes').value,
      opened_at: Date.now(),
      closed_at: g('tm-status').value === 'CLOSED' ? Date.now() : null
    };
    const id = g('tm-id').value;
    if (id) data.id = id;
    try {
      await save(data);
      document.getElementById('trade-modal').hidden = true;
      await loadAll(); render(); App.refreshDashboard();
      App.toast('تم حفظ الصفقة ✅', 'ok');
    } catch (e) { App.toast(e.message, 'err'); }
  }

  function bind() {
    document.getElementById('new-trade-btn').addEventListener('click', () => openModal(null));
    document.getElementById('tm-save-btn').addEventListener('click', saveFromModal);
    document.getElementById('trades-search').addEventListener('input', render);
    document.getElementById('trades-filter').addEventListener('change', render);
    tbody().addEventListener('click', async e => {
      const editBtn = e.target.closest('[data-edit]');
      const delBtn = e.target.closest('[data-del]');
      if (editBtn) openModal(cache.find(t => t.id === editBtn.dataset.edit));
      if (delBtn && confirm('حذف هذه الصفقة؟')) {
        await remove(delBtn.dataset.del);
        await loadAll(); render(); App.refreshDashboard();
        App.toast('تم الحذف', 'ok');
      }
    });
  }

  async function init() { bind(); await loadAll(); render(); }

  return { init, loadAll, render, getCache, openTrades, save };
})();
