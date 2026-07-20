/* ============================================================
   AI ANALYSIS + LIVE CHAT
   - Multi-image upload (drag/drop/paste/pick)
   - Sends system prompt + app context + images to Gemini
   - Session memory (conversation history kept per session)
   - Saves each full analysis to tables/analyses (versioned)
   - Updates watchlist bias automatically
   ============================================================ */
'use strict';

const Analysis = (() => {
  let pendingImages = [];   // [{part:{inlineData}, previewUrl}]
  let history = [];         // Gemini contents [{role, parts}]
  let lastAnalysisRecord = null; // last saved analysis (for versioning)
  let busy = false;

  const $ = id => document.getElementById(id);

  // ---------- image handling ----------
  async function addFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (pendingImages.length >= 8) { App.toast('الحد الأقصى 8 صور لكل تحليل', 'warn'); break; }
      try {
        const part = await Gemini.fileToImagePart(file);
        pendingImages.push(part);
      } catch (e) { App.toast(e.message, 'err'); }
    }
    renderPreviews();
  }

  function renderPreviews() {
    $('image-previews').innerHTML = pendingImages.map((p, i) => `
      <div class="img-preview">
        <img src="${p.previewUrl}" alt="صورة ${i + 1}">
        <button class="remove-img" data-i="${i}" aria-label="حذف"><i class="fa-solid fa-xmark"></i></button>
        <span class="img-order">${i + 1}</span>
      </div>`).join('');
  }

  // ---------- chat rendering ----------
  function chatEl() { return $('chat-messages'); }

  function clearWelcome() {
    const w = chatEl().querySelector('.chat-welcome');
    if (w) w.remove();
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function addUserMsg(text, imgs) {
    clearWelcome();
    const div = document.createElement('div');
    div.className = 'msg user';
    let html = '';
    if (imgs && imgs.length) {
      html += `<div class="msg-images">${imgs.map(p => `<img src="${p.previewUrl}" alt="">`).join('')}</div>`;
    }
    html += `<div>${esc(text).replace(/\n/g, '<br>')}</div>`;
    div.innerHTML = html;
    chatEl().appendChild(div);
    scrollChat();
  }

  function addTyping() {
    const div = document.createElement('div');
    div.className = 'msg ai';
    div.id = 'typing-msg';
    div.innerHTML = `<div class="msg-meta"><i class="fa-solid fa-brain"></i> بيحلل... (Analyzing)</div>
      <div class="typing-indicator"><span></span><span></span><span></span></div>`;
    chatEl().appendChild(div);
    scrollChat();
  }
  function removeTyping() { const t = $('typing-msg'); if (t) t.remove(); }

  function decisionChip(decision) {
    if (!decision) return '';
    const d = decision.toUpperCase();
    let cls = 'notrade', icon = 'fa-ban';
    if (d.includes('BUY')) { cls = 'buy'; icon = 'fa-arrow-trend-up'; }
    else if (d.includes('SELL')) { cls = 'sell'; icon = 'fa-arrow-trend-down'; }
    else if (d === 'WAIT') { cls = 'wait'; icon = 'fa-hourglass-half'; }
    return `<span class="decision-chip ${cls}"><i class="fa-solid ${icon}"></i> ${esc(d)}</span>`;
  }

  function confidenceBar(conf) {
    if (conf == null || isNaN(conf)) return '';
    const c = Math.max(0, Math.min(100, Number(conf)));
    const color = c >= 90 ? 'var(--green)' : c >= 80 ? 'var(--primary)' : c >= 70 ? 'var(--amber)' : 'var(--red)';
    return `<div class="confidence-bar-wrap">
      <div class="confidence-bar-label"><span>الثقة (Confidence)</span><span>${c}%</span></div>
      <div class="confidence-bar"><div class="fill" style="width:${c}%;background:${color}"></div></div>
    </div>`;
  }

  function addAiMsg(text, model, meta) {
    removeTyping();
    const div = document.createElement('div');
    div.className = 'msg ai';
    let header = `<div class="msg-meta"><i class="fa-solid fa-robot"></i> ${esc(model || '')}`;
    if (meta && meta.decision) header += ` &nbsp;${decisionChip(meta.decision)}`;
    header += `</div>`;
    let extra = meta && meta.confidence != null ? confidenceBar(meta.confidence) : '';
    div.innerHTML = header + extra + `<div class="msg-md">${marked.parse(text)}</div>`;
    chatEl().appendChild(div);
    scrollChat();
  }

  function scrollChat() {
    const el = chatEl();
    el.scrollTop = el.scrollHeight;
  }

  // ---------- context building ----------
  function buildContext(intent) {
    const s = App.getSettings();
    const ctx = {
      userName: s.name || '',
      market: $('an-market').value.trim().toUpperCase(),
      timeframe: $('an-timeframe').value,
      imageType: $('an-image-type').value,
      intent,
      riskProfile: {
        balance: s.balance || null,
        risk: s.risk || 1,
        maxDaily: s.maxDaily || 3,
        minRR: s.minRR || 2,
        strict: s.strict !== false,
        coach: s.coach !== false
      },
      openTrades: Trades.openTrades()
    };
    if (intent === 'update' && $('an-parent').value) {
      const prev = App.analysesCache.find(a => a.id === $('an-parent').value);
      if (prev) ctx.previousAnalysis = prev;
    } else if (lastAnalysisRecord) {
      ctx.previousAnalysis = lastAnalysisRecord;
    }
    return ctx;
  }

  // ---------- main analyze ----------
  async function runAnalysis() {
    if (busy) return;
    if (!Gemini.hasKey()) {
      App.toast('أضف مفتاح Gemini API من الإعدادات أولاً', 'warn');
      App.showView('settings');
      return;
    }
    const notes = $('an-notes').value.trim();
    if (!pendingImages.length && !notes) {
      $('analysis-warning').textContent = '⚠️ ارفع صورة شارت أو اكتب ملاحظات على الأقل.';
      $('analysis-warning').style.display = 'block';
      return;
    }
    $('analysis-warning').style.display = 'none';

    const intent = $('an-intent').value;
    const ctx = buildContext(intent);
    const intentLabels = {
      new_trade: 'أبحث عن صفقة جديدة (New Trade)',
      update: 'ده تحديث للتحليل السابق — قارن واشرح إيه اللي اتغير (Update)',
      manage: 'عندي صفقة مفتوحة وعايز أديرها (Position Management)',
      bias: 'عايز اتجاه السوق فقط بدون خطة صفقة (Market Bias)',
      education: 'اشرحلي وعلمني (Education)',
      news: 'حلل تأثير الأخبار (News Analysis)'
    };
    let userText = intentLabels[intent] || '';
    if (ctx.market) userText += `\nالسوق: ${ctx.market}`;
    if (ctx.timeframe) userText += `\nالفريم: ${ctx.timeframe}`;
    if (pendingImages.length) userText += `\nعدد الصور المرفوعة: ${pendingImages.length} (نوعها: ${ctx.imageType})`;
    if (notes) userText += `\nملاحظاتي: ${notes}`;

    const parts = [{ text: buildAppContext(ctx) + '\n\n' + userText }];
    pendingImages.forEach(p => parts.push({ inlineData: p.part ? p.part.inlineData : p.inlineData }));

    const imgsForDisplay = pendingImages.slice();
    addUserMsg(userText, imgsForDisplay);

    history.push({ role: 'user', parts });
    pendingImages = [];
    renderPreviews();

    await sendToGemini(true, ctx);
  }

  // ---------- follow-up chat ----------
  async function sendChat() {
    if (busy) return;
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text && !pendingImages.length) return;
    if (!Gemini.hasKey()) {
      App.toast('أضف مفتاح Gemini API من الإعدادات أولاً', 'warn');
      App.showView('settings');
      return;
    }
    const ctx = buildContext('follow_up');
    const parts = [];
    const fullText = (history.length === 0 ? buildAppContext(ctx) + '\n\n' : '') + text;
    parts.push({ text: fullText });
    pendingImages.forEach(p => parts.push({ inlineData: p.part ? p.part.inlineData : p.inlineData }));

    addUserMsg(text || '(صور مرفقة)', pendingImages);
    history.push({ role: 'user', parts });
    input.value = ''; input.style.height = 'auto';
    pendingImages = [];
    renderPreviews();

    await sendToGemini(false, ctx);
  }

  async function sendToGemini(isFullAnalysis, ctx) {
    busy = true;
    $('analyze-btn').disabled = true;
    $('chat-send-btn').disabled = true;
    App.setAiStatus('thinking');
    addTyping();

    try {
      const { text, model } = await Gemini.generate(history, {
        onStatus: m => { $('model-badge').textContent = m; }
      });
      history.push({ role: 'model', parts: [{ text }] });
      // keep history bounded (system prompt is separate)
      if (history.length > 24) history = history.slice(-20);

      const json = Gemini.extractJson(text);
      addAiMsg(text, model, json || {});
      App.setAiStatus('connected');

      if (isFullAnalysis && json && json.decision) {
        await persistAnalysis(text, json, model, ctx);
      }
    } catch (e) {
      removeTyping();
      App.setAiStatus('disconnected');
      if (e.message === 'NO_KEY') {
        App.toast('أضف مفتاح API من الإعدادات', 'warn');
      } else {
        addAiMsg(`**⚠️ خطأ:** ${esc(e.message)}`, 'system', {});
      }
    } finally {
      busy = false;
      $('analyze-btn').disabled = false;
      $('chat-send-btn').disabled = false;
    }
  }

  // ---------- persistence ----------
  async function persistAnalysis(fullText, json, model, ctx) {
    try {
      const parentId = (ctx.previousAnalysis && ctx.intent === 'update')
        ? (ctx.previousAnalysis.parent_id || ctx.previousAnalysis.id) : null;
      const version = parentId
        ? (App.analysesCache.filter(a => a.id === parentId || a.parent_id === parentId).length + 1)
        : 1;
      const num = v => (v == null || isNaN(v)) ? null : Number(v);
      const record = {
        market: json.market || ctx.market || '—',
        timeframe: ctx.timeframe || '',
        decision: json.decision || 'WAIT',
        confidence: num(json.confidence),
        bias: json.bias || 'Neutral',
        entry: num(json.entry), stop_loss: num(json.stop_loss),
        tp1: num(json.tp1), tp2: num(json.tp2), tp3: num(json.tp3),
        risk_reward: json.risk_reward || '',
        summary: fullText,
        version, parent_id: parentId,
        images_count: 0, model_used: model
      };
      const res = await fetch('tables/analyses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
      if (res.ok) {
        lastAnalysisRecord = await res.json();
        await App.loadAnalyses();
        await updateWatchlistFromAnalysis(record, lastAnalysisRecord.id);
        App.refreshDashboard();
      }
    } catch { /* non-fatal */ }
  }

  async function updateWatchlistFromAnalysis(record, analysisId) {
    if (!record.market || record.market === '—') return;
    try {
      const res = await fetch('tables/watchlist?limit=200');
      const json = await res.json();
      const existing = (json.data || []).find(w => !w.deleted && (w.symbol || '').toUpperCase() === record.market.toUpperCase());
      const payload = {
        symbol: record.market.toUpperCase(),
        bias: record.bias, confidence: record.confidence,
        trend: record.bias, last_analysis: analysisId
      };
      if (existing) {
        await fetch(`tables/watchlist/${existing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      App.renderWatchlist && App.renderWatchlist();
    } catch { /* non-fatal */ }
  }

  // ---------- session ----------
  function newSession() {
    history = [];
    lastAnalysisRecord = null;
    chatEl().innerHTML = `<div class="chat-welcome">
      <i class="fa-solid fa-shield-halved"></i>
      <h4>جلسة جديدة</h4>
      <p>ارفع الشارت واكتب ملاحظاتك — حماية رأس المال أولاً.</p></div>`;
  }

  /** Load a previous analysis as context to continue */
  function continueFrom(record) {
    lastAnalysisRecord = record;
    newSession();
    clearWelcome();
    addAiMsg(`**استكمال التحليل السابق (${esc(record.market)})** — القرار السابق: ${esc(record.decision)} بثقة ${record.confidence ?? '—'}%.\n\nارفع صورة محدثة للشارت واختر "تحديث تحليل سابق" وسأقارن وأوضح إيه اللي اتغير.`, 'system', { decision: record.decision, confidence: record.confidence });
    $('an-intent').value = 'update';
    $('an-market').value = record.market || '';
    updateParentVisibility();
    App.showView('analysis');
  }

  function updateParentVisibility() {
    const isUpdate = $('an-intent').value === 'update';
    $('an-parent-group').style.display = isUpdate ? '' : 'none';
    if (isUpdate) {
      const sel = $('an-parent');
      sel.innerHTML = App.analysesCache.slice(0, 30).map(a =>
        `<option value="${a.id}">${esc(a.market)} — ${esc(a.decision)} (${a.confidence ?? '—'}%) v${a.version || 1}</option>`).join('');
      if (lastAnalysisRecord) sel.value = lastAnalysisRecord.id;
    }
  }

  // ---------- bindings ----------
  function bind() {
    const dz = $('drop-zone');
    const fi = $('file-input');
    dz.addEventListener('click', e => { if (!e.target.closest('label')) fi.click(); });
    fi.addEventListener('change', () => { addFiles([...fi.files]); fi.value = ''; });
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));
    document.addEventListener('paste', e => {
      if (!document.getElementById('view-analysis').classList.contains('active')) return;
      const files = [...(e.clipboardData || {}).items || []]
        .filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
      if (files.length) { addFiles(files); App.toast('تم لصق الصورة 📋', 'ok'); }
    });
    $('image-previews').addEventListener('click', e => {
      const btn = e.target.closest('.remove-img');
      if (btn) { pendingImages.splice(Number(btn.dataset.i), 1); renderPreviews(); }
    });

    $('analyze-btn').addEventListener('click', runAnalysis);
    $('chat-send-btn').addEventListener('click', sendChat);
    const ci = $('chat-input');
    ci.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    ci.addEventListener('input', () => {
      ci.style.height = 'auto';
      ci.style.height = Math.min(ci.scrollHeight, 130) + 'px';
    });
    $('clear-chat-btn').addEventListener('click', () => {
      if (history.length === 0 || confirm('بدء جلسة جديدة؟ المحادثة الحالية ستُمسح (التحليلات المحفوظة تفضل في السجل).')) newSession();
    });
    $('an-intent').addEventListener('change', updateParentVisibility);
  }

  return { init: bind, continueFrom, updateParentVisibility };
})();
