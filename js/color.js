/*
 * color.js — conversões de cor e métricas perceptuais.
 * sRGB (D65) <-> XYZ <-> CIELAB / LCh, e diferença CIEDE2000 (ΔE00).
 * Sem dependências; funciona no navegador (window.ColorMath) e no Node (require).
 */
(function (global) {
  'use strict';

  var WHITE = { X: 0.95047, Y: 1.0, Z: 1.08883 };
  var EPS = 216 / 24389;
  var KAPPA = 24389 / 27;
  var DEG = Math.PI / 180;

  function srgbToLinear(c8) {
    var c = c8 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(v) {
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  function f(t) {
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  }

  function finv(ft) {
    var t3 = ft * ft * ft;
    return t3 > EPS ? t3 : (116 * ft - 16) / KAPPA;
  }

  /** [r,g,b] 0–255 -> {L,a,b} */
  function rgbToLab(rgb) {
    var r = srgbToLinear(rgb[0]);
    var g = srgbToLinear(rgb[1]);
    var b = srgbToLinear(rgb[2]);
    var X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
    var Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    var Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
    var fx = f(X / WHITE.X);
    var fy = f(Y / WHITE.Y);
    var fz = f(Z / WHITE.Z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  /** {L,a,b} -> [r,g,b] linear (pode estar fora de [0,1]) */
  function labToLinearRgb(lab) {
    var fy = (lab.L + 16) / 116;
    var fx = fy + lab.a / 500;
    var fz = fy - lab.b / 200;
    var X = finv(fx) * WHITE.X;
    var Y = finv(fy) * WHITE.Y;
    var Z = finv(fz) * WHITE.Z;
    return [
      3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
      -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
      0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z
    ];
  }

  /**
   * {L,a,b} -> [r,g,b] inteiros 0–255, ou null se a cor estiver fora do gamut sRGB
   * (isto é, não é renderizável sem recorte).
   */
  function labToRgb(lab) {
    var lin = labToLinearRgb(lab);
    var out = new Array(3);
    for (var i = 0; i < 3; i++) {
      var v = lin[i];
      if (!(v >= -1e-4 && v <= 1 + 1e-4)) return null;
      v = Math.min(1, Math.max(0, v));
      out[i] = Math.round(linearToSrgb(v) * 255);
    }
    return out;
  }

  function lchToLab(lch) {
    return { L: lch.L, a: lch.C * Math.cos(lch.h * DEG), b: lch.C * Math.sin(lch.h * DEG) };
  }

  function labToLch(lab) {
    var h = Math.atan2(lab.b, lab.a) / DEG;
    if (h < 0) h += 360;
    return { L: lab.L, C: Math.hypot(lab.a, lab.b), h: h };
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) {
      return v.toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  /** CIEDE2000 (Sharma, Wu & Dalal, 2005). */
  function deltaE2000(c1, c2) {
    var L1 = c1.L, a1 = c1.a, b1 = c1.b;
    var L2 = c2.L, a2 = c2.a, b2 = c2.b;
    var P25 = 6103515625; // 25^7

    var C1 = Math.hypot(a1, b1);
    var C2 = Math.hypot(a2, b2);
    var Cbar7 = Math.pow((C1 + C2) / 2, 7);
    var G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + P25)));
    var a1p = (1 + G) * a1;
    var a2p = (1 + G) * a2;
    var C1p = Math.hypot(a1p, b1);
    var C2p = Math.hypot(a2p, b2);

    function hue(b, ap) {
      if (b === 0 && ap === 0) return 0;
      var h = Math.atan2(b, ap) / DEG;
      return h < 0 ? h + 360 : h;
    }
    var h1p = hue(b1, a1p);
    var h2p = hue(b2, a2p);

    var dLp = L2 - L1;
    var dCp = C2p - C1p;
    var dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG);

    var Lbp = (L1 + L2) / 2;
    var Cbp = (C1p + C2p) / 2;
    var hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
    else hbp = (h1p + h2p - 360) / 2;

    var T = 1
      - 0.17 * Math.cos((hbp - 30) * DEG)
      + 0.24 * Math.cos(2 * hbp * DEG)
      + 0.32 * Math.cos((3 * hbp + 6) * DEG)
      - 0.2 * Math.cos((4 * hbp - 63) * DEG);
    var dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    var Cbp7 = Math.pow(Cbp, 7);
    var RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + P25));
    var Lm = (Lbp - 50) * (Lbp - 50);
    var SL = 1 + (0.015 * Lm) / Math.sqrt(20 + Lm);
    var SC = 1 + 0.045 * Cbp;
    var SH = 1 + 0.015 * Cbp * T;
    var RT = -Math.sin(2 * dTheta * DEG) * RC;

    var tL = dLp / SL, tC = dCp / SC, tH = dHp / SH;
    return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
  }

  var api = {
    rgbToLab: rgbToLab,
    labToRgb: labToRgb,
    lchToLab: lchToLab,
    labToLch: labToLch,
    rgbToHex: rgbToHex,
    deltaE2000: deltaE2000
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.ColorMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
