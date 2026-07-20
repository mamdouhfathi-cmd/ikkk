/* ============================================================
   GEMINI API CLIENT
   - Direct browser calls to Google Generative Language API
   - Multi-image support (inline base64)
   - Automatic fallback model on quota / availability errors
   - User-friendly Arabic error messages
   ============================================================ */
'use strict';

const Gemini = (() => {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  function getSettings() {
    try { return JSON.parse(localStorage.getItem('ai_trader_settings') || '{}'); }
    catch { return {}; }
  }

  function apiKey() { return (getSettings().apiKey || '').trim(); }

  function primaryModel() {
    const s = getSettings();
    if (s.model === 'custom' && s.customModel) return s.customModel.trim();
    return s.model || 'gemini-2.5-flash';
  }
  function fallbackModel() {
    const s = getSettings();
    const fb = (s.fallback || '').trim();
    return fb && fb !== primaryModel() ? fb : null;
  }

  function friendlyError(status, body) {
    const msg = (body && body.error && body.error.message) || '';
    if (status === 400 && /API key/i.test(msg)) return 'مفتاح API غير صالح (Invalid API Key) — راجع الإعدادات.';
    if (status === 401 || status === 403) return 'مفتاح API مرفوض (Unauthorized) — تأكد من المفتاح والصلاحيات.';
    if (status === 404) return 'الموديل غير متاح (Model Unavailable) — جرّب موديل آخر من الإعدادات.';
    if (status === 429) return 'تم تجاوز الحد المسموح (Rate Limit / Quota Exceeded) — استنى دقيقة وحاول تاني.';
    if (status >= 500) return 'خطأ من خادم Google — حاول تاني بعد قليل.';
    return msg || `خطأ غير متوقع (HTTP ${status}).`;
  }

  /**
   * contents: Gemini "contents" array [{role, parts:[...]}, ...]
   * Returns { text, model }
   */
  async function generate(contents, { onStatus } = {}) {
    const key = apiKey();
    if (!key) throw new Error('NO_KEY');

    const models = [primaryModel()];
    const fb = fallbackModel();
    if (fb) models.push(fb);

    let lastErr = null;
    for (const model of models) {
      if (onStatus) onStatus(model);
      try {
        const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: TRADING_SYSTEM_PROMPT }] },
            contents,
            generationConfig: { temperature: 0.4, maxOutputTokens: 8192 }
          })
        });
        let body = null;
        try { body = await res.json(); } catch { /* ignore */ }

        if (!res.ok) {
          lastErr = new Error(friendlyError(res.status, body));
          // fall through to fallback for retryable statuses
          if ([404, 429, 500, 503].includes(res.status)) continue;
          throw lastErr;
        }
        const cand = body && body.candidates && body.candidates[0];
        const text = cand && cand.content && cand.content.parts
          ? cand.content.parts.map(p => p.text || '').join('')
          : '';
        if (!text) {
          const reason = (cand && cand.finishReason) || (body && body.promptFeedback && body.promptFeedback.blockReason) || 'EMPTY';
          lastErr = new Error(`الرد جاء فارغ (${reason}) — حاول تاني أو قلّل حجم الصور.`);
          continue;
        }
        return { text, model };
      } catch (e) {
        if (e.message === 'NO_KEY') throw e;
        if (e instanceof TypeError) {
          lastErr = new Error('خطأ في الشبكة (Network Error) — تأكد من الاتصال بالإنترنت.');
          continue;
        }
        lastErr = e;
      }
    }
    throw lastErr || new Error('فشل الاتصال بالموديل.');
  }

  async function testConnection() {
    const { text, model } = await generate([{ role: 'user', parts: [{ text: 'رد بكلمة واحدة فقط: متصل' }] }]);
    return { ok: true, model, text: text.trim().slice(0, 60) };
  }

  /** Compress + convert an image File/Blob to inline base64 part */
  function fileToImagePart(file, maxDim = 1600, quality = 0.86) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (Math.max(width, height) > maxDim) {
          const s = maxDim / Math.max(width, height);
          width = Math.round(width * s); height = Math.round(height * s);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({
          inlineData: { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] },
          previewUrl: dataUrl
        });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة.')); };
      img.src = url;
    });
  }

  /** Extract trailing ```json block from AI response */
  function extractJson(text) {
    const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
    if (!matches.length) return null;
    try {
      const parsed = JSON.parse(matches[matches.length - 1][1].trim());
      return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch { return null; }
  }

  return { generate, testConnection, fileToImagePart, extractJson, primaryModel, hasKey: () => !!apiKey() };
})();
