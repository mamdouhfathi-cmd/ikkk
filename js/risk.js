/* ============================================================
   RISK CALCULATOR ENGINE
   Pip sizes & per-lot pip values for common instruments.
   Values are standard broker conventions — user can override
   via "Custom" market.
   ============================================================ */
'use strict';

const RiskEngine = (() => {
  // pipSize: price change of "1 pip"; pipValue: USD per pip per 1.0 standard lot
  const SPECS = {
    XAUUSD: { pipSize: 0.1,    pipValue: 10,  name: 'الذهب (Gold)' },
    XAGUSD: { pipSize: 0.01,   pipValue: 50,  name: 'الفضة (Silver)' },
    EURUSD: { pipSize: 0.0001, pipValue: 10 },
    GBPUSD: { pipSize: 0.0001, pipValue: 10 },
    AUDUSD: { pipSize: 0.0001, pipValue: 10 },
    NZDUSD: { pipSize: 0.0001, pipValue: 10 },
    USDJPY: { pipSize: 0.01,   pipValue: 6.7, approx: true },
    USDCAD: { pipSize: 0.0001, pipValue: 7.3, approx: true },
    BTCUSD: { pipSize: 1,      pipValue: 1 },
    ETHUSD: { pipSize: 1,      pipValue: 1 },
    US30:   { pipSize: 1,      pipValue: 1 },
    NAS100: { pipSize: 1,      pipValue: 1 },
    SPX500: { pipSize: 0.1,    pipValue: 0.1 },
    USOIL:  { pipSize: 0.01,   pipValue: 10 }
  };

  /**
   * calculate({market, balance, riskPct, entry, sl, tp1, tp2, tp3, customPipSize, customPipValue})
   */
  function calculate(o) {
    const errors = [];
    if (!o.balance || o.balance <= 0) errors.push('أدخل رصيد الحساب (Balance).');
    if (!o.entry || o.entry <= 0) errors.push('أدخل سعر الدخول (Entry).');
    if (!o.sl || o.sl <= 0) errors.push('أدخل وقف الخسارة (Stop Loss).');
    if (o.entry && o.sl && o.entry === o.sl) errors.push('الدخول ووقف الخسارة لا يمكن أن يتساويا.');
    if (!o.riskPct || o.riskPct <= 0) errors.push('أدخل نسبة المخاطرة (Risk %).');

    let spec;
    if (o.market === 'CUSTOM') {
      if (!o.customPipSize || !o.customPipValue) errors.push('أدخل حجم النقطة وقيمتها للسوق المخصص.');
      spec = { pipSize: o.customPipSize, pipValue: o.customPipValue };
    } else {
      spec = SPECS[o.market];
      if (!spec) errors.push('سوق غير مدعوم — استخدم "مخصص".');
    }
    if (errors.length) return { errors };

    const direction = o.entry > o.sl ? 'BUY' : 'SELL';
    const slDistance = Math.abs(o.entry - o.sl);
    const slPips = slDistance / spec.pipSize;
    const riskAmount = o.balance * (o.riskPct / 100);
    const lotRaw = riskAmount / (slPips * spec.pipValue);
    const lot = Math.max(0.01, Math.floor(lotRaw * 100) / 100);
    const actualRisk = lot * slPips * spec.pipValue;

    const tps = [o.tp1, o.tp2, o.tp3].map((tp, i) => {
      if (!tp || tp <= 0) return null;
      const dist = direction === 'BUY' ? tp - o.entry : o.entry - tp;
      if (dist <= 0) return { n: i + 1, invalid: true };
      const rr = dist / slDistance;
      const profit = lot * (dist / spec.pipSize) * spec.pipValue;
      return { n: i + 1, rr, profit, pips: dist / spec.pipSize };
    }).filter(Boolean);

    const warnings = [];
    if (o.riskPct > 3) warnings.push(`⚠️ مخاطرة ${o.riskPct}% أعلى من الحد الآمن (3%) — خطر عالي جداً.`);
    else if (o.riskPct > 2) warnings.push(`⚠️ مخاطرة ${o.riskPct}% تعتبر عالية.`);
    if (lotRaw < 0.01) warnings.push('⚠️ حجم اللوت المحسوب أقل من الحد الأدنى (0.01) — المخاطرة الفعلية أعلى من المطلوب.');
    tps.forEach(t => { if (t.invalid) warnings.push(`⚠️ TP${t.n} في الاتجاه الخطأ بالنسبة للدخول.`); });
    const minRR = parseFloat(o.minRR || 2);
    const bestRR = tps.filter(t => !t.invalid).reduce((m, t) => Math.max(m, t.rr), 0);
    let rrStatus = null;
    if (tps.some(t => !t.invalid)) {
      rrStatus = bestRR >= minRR
        ? { ok: true, text: `✅ العائد للمخاطرة (RR) حتى 1:${bestRR.toFixed(1)} — أعلى من حدك الأدنى (1:${minRR}).` }
        : { ok: false, text: `❌ أفضل عائد للمخاطرة 1:${bestRR.toFixed(1)} — أقل من حدك الأدنى (1:${minRR}). الصفقة مرفوضة حسب قواعدك.` };
    }

    return {
      direction, slPips, riskAmount, actualRisk, lot, lotRaw,
      pipValue: spec.pipValue, approx: !!spec.approx, tps: tps.filter(t => !t.invalid),
      warnings, rrStatus
    };
  }

  return { calculate, SPECS };
})();
