/* ============================================================
   TRADING JOURNAL — CRUD via RESTful Table API (tables/journal)
   ============================================================ */
'use strict';

const Journal = (() => {
  let cache = [];

  async function loadAll() {
    try {
      const res = await fetch('tables/journal?limit=500&sort=-created_at');
      const json = await res.json();
      cache = (json.data || []).filter(j => !j.deleted);
    } catch { cache = []; }
    return cache;
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render() {
    const q = (document.getElementById('journal-search').value || '').toLowerCase();
    const rows = cache.filter(j => !q ||
      [j.market, j.entry_reason, j.exit_reason, j.mistakes, j.lessons, j.emotion]
        .some(v => (v || '').toLowerCase().includes(q)));

    const list = document.getElementById('journal-list');
    list.innerHTML = rows.map(j => {
      const date = j.created_at ? new Date(j.created_at).toLocaleString('ar-EG') : '';
      const resCls = { WIN: 'win', LOSS: 'loss', BREAKEVEN: 'breakeven' }[j.result] || 'none';
      const field = (label, v) => v ? `<div class="journal-field"><b>${label}:</b> ${esc(v)}</div>` : '';
      return `<article class="journal-entry">
        <div class="journal-entry-header">
          <span class="sym">${esc(j.market || '—')}</span>
          <span class="badge ${resCls}">${esc(j.result || '—')}</span>
          <span class="badge none">${esc(j.emotion || '')}</span>
          <span class="date">${date}</span>
          <span>
            <button class="icon-btn" data-edit="${j.id}" title="تعديل"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn danger" data-del="${j.id}" title="حذف"><i class="fa-solid fa-trash"></i></button>
          </span>
        </div>
        ${field('سبب الدخول (Entry Reason)', j.entry_reason)}
        ${field('سبب الخروج (Exit Reason)', j.exit_reason)}
        ${field('الأخطاء (Mistakes)', j.mistakes)}
        ${field('الدروس (Lessons)', j.lessons)}
      </article>`;
    }).join('');
    document.getElementById('journal-empty').classList.toggle('show', rows.length === 0);
  }

  function openModal(entry) {
    const g = id => document.getElementById(id);
    document.getElementById('journal-modal-title').textContent = entry ? 'تعديل الإدخال' : 'إدخال جديد في اليومية';
    g('jm-id').value = entry ? entry.id : '';
    g('jm-market').value = entry ? (entry.market || '') : '';
    g('jm-emotion').value = entry ? (entry.emotion || 'منضبط') : 'منضبط';
    g('jm-result').value = entry ? (entry.result || 'WIN') : 'WIN';
    g('jm-entry-reason').value = entry ? (entry.entry_reason || '') : '';
    g('jm-exit-reason').value = entry ? (entry.exit_reason || '') : '';
    g('jm-mistakes').value = entry ? (entry.mistakes || '') : '';
    g('jm-lessons').value = entry ? (entry.lessons || '') : '';
    document.getElementById('journal-modal').hidden = false;
  }

  async function saveFromModal() {
    const g = id => document.getElementById(id);
    const data = {
      market: g('jm-market').value.trim().toUpperCase(),
      emotion: g('jm-emotion').value,
      result: g('jm-result').value,
      entry_reason: g('jm-entry-reason').value,
      exit_reason: g('jm-exit-reason').value,
      mistakes: g('jm-mistakes').value,
      lessons: g('jm-lessons').value
    };
    const id = g('jm-id').value;
    const url = id ? `tables/journal/${id}` : 'tables/journal';
    try {
      const res = await fetch(url, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('فشل الحفظ.');
      document.getElementById('journal-modal').hidden = true;
      await loadAll(); render();
      App.toast('تم حفظ الإدخال ✅', 'ok');
    } catch (e) { App.toast(e.message, 'err'); }
  }

  function bind() {
    document.getElementById('new-journal-btn').addEventListener('click', () => openModal(null));
    document.getElementById('jm-save-btn').addEventListener('click', saveFromModal);
    document.getElementById('journal-search').addEventListener('input', render);
    document.getElementById('journal-list').addEventListener('click', async e => {
      const editBtn = e.target.closest('[data-edit]');
      const delBtn = e.target.closest('[data-del]');
      if (editBtn) openModal(cache.find(j => j.id === editBtn.dataset.edit));
      if (delBtn && confirm('حذف هذا الإدخال؟')) {
        await fetch(`tables/journal/${delBtn.dataset.del}`, { method: 'DELETE' });
        await loadAll(); render();
        App.toast('تم الحذف', 'ok');
      }
    });
  }

  async function init() { bind(); await loadAll(); render(); }

  return { init, loadAll, render };
})();
