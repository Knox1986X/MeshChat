// Атмосферный графический слой MeshChat v1.8:
//   1. Аппаратно-ускоренный генератор многослойного снегопада (6-лучевые дендритные снежинки,
//      пушистые хлопья, морозная пыль), вьюги, полярного сияния, золотых искр и звёздного неба.
//   2. Праздничная светящаяся гирлянда (SVG) с реалистичным свечением стеклянных ламп.
// Автоматически приостанавливает цикл отрисовки при сворачивании вкладки/приложения (0% расхода батареи в фоне).

import { html, useEffect, useRef } from '../../vendor/preact.mjs';
import { store } from '../store/app-store.mjs';

const GARLAND_PALETTES = {
  classic: ['#ff4d6d', '#fbbf24', '#10b981', '#38bdf8', '#f97316', '#a855f7'],
  warm_gold: ['#fde047', '#f59e0b', '#fef3c7', '#fb923c', '#fde68a'],
  arctic_ice: ['#38bdf8', '#e0f2fe', '#818cf8', '#22d3ee', '#c7d2fe'],
  cyber_berry: ['#f43f5e', '#c084fc', '#2dd4bf', '#60a5fa', '#fb7185'],
};

/** Рисует симметричную 6-лучевую кристаллическую снежинку с боковыми веточками */
function drawCrystalSnowflake(ctx, radius) {
  ctx.beginPath();
  for (let arm = 0; arm < 6; arm++) {
    const angle = (arm * Math.PI) / 3;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Главный луч кристалла
    ctx.moveTo(0, 0);
    ctx.lineTo(cos * radius, sin * radius);

    // Две пары симметричных боковых веточек под 60°
    for (const frac of [0.46, 0.74]) {
      const bx = cos * radius * frac;
      const by = sin * radius * frac;
      const branchLen = radius * (frac === 0.46 ? 0.36 : 0.24);
      for (const side of [-1, 1]) {
        const bAngle = angle + side * (Math.PI / 3);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(bAngle) * branchLen, by + Math.sin(bAngle) * branchLen);
      }
    }
  }
  ctx.stroke();
}

/** Рисует 4-лучевую новогоднюю искру */
function drawSparkleStar(ctx, radius) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.24;
    const a = (i * Math.PI) / 4;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

/** Светящаяся новогодняя гирлянда вдоль верхнего края окна */
export function FestiveGarland({ styleId = 'classic' }) {
  const palette = GARLAND_PALETTES[styleId] || GARLAND_PALETTES.classic;
  const bulbCount = 18;
  const bulbs = Array.from({ length: bulbCount }, (_, i) => {
    const xPct = (i + 0.5) * (100 / bulbCount);
    const sag = i % 2 === 0 ? 11 : 17;
    const color = palette[i % palette.length];
    const delay = `${((i * 0.37) % 2.4).toFixed(2)}s`;
    const dur = `${(2.1 + (i % 4) * 0.45).toFixed(2)}s`;
    return { xPct, sag, color, delay, dur };
  });

  // Плавный провисающий провод гирлянды
  let wireD = 'M 0 3';
  const step = 1000 / bulbCount;
  for (let i = 0; i < bulbCount; i++) {
    const x1 = i * step + step * 0.5;
    const x2 = (i + 1) * step;
    wireD += ` Q ${x1.toFixed(1)} 22, ${x2.toFixed(1)} 4`;
  }

  return html`<div class="festive-garland-wrap" aria-hidden="true">
    <svg class="festive-garland-wire" viewBox="0 0 1000 32" preserveAspectRatio="none">
      <path d=${wireD} fill="none" stroke="rgba(148, 163, 184, 0.34)" stroke-width="1.6" />
    </svg>
    <div class="festive-bulbs-row">
      ${bulbs.map((b, idx) => html`<span
        key=${idx}
        class="garland-bulb"
        style=${`left:${b.xPct.toFixed(2)}%;top:${b.sag}px;--bulb-color:${b.color};animation-delay:${b.delay};animation-duration:${b.dur}`}
      >
        <i class="bulb-cap"></i>
        <i class="bulb-glass"></i>
      </span>`)}
    </div>
  </div>`;
}

/** Полноэкранный атмосферный слой снежинок, полярного сияния и новогодней гирлянды */
export function AtmosphereLayer() {
  const canvasRef = useRef(null);
  const { theme } = store;

  const effect = theme.ambientEffect || 'snowfall';
  const density = theme.snowDensity || 'medium';
  const garlandOn = Boolean(theme.garlandEnabled);
  const garlandStyle = theme.garlandStyle || 'classic';
  const animationsOn = theme.animations !== false;

  useEffect(() => {
    if (!animationsOn || effect === 'none') return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let paused = typeof document !== 'undefined' ? document.hidden : false;

    const baseCount = density === 'rich' ? 92 : density === 'light' ? 34 : 58;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth || 360;
      height = window.innerHeight || 780;
      // На мобильных экранах масштабируем число частиц пропорционально площади для стабильных 60 FPS
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const areaFactor = Math.max(0.55, Math.min(1.35, (width * height) / (1280 * 800)));
    const count = Math.max(22, Math.round(baseCount * areaFactor));

    const sparkColors = ['#fde047', '#fbbf24', '#f472b6', '#38bdf8', '#a7f3d0', '#ffffff'];

    const createParticle = (initial = false) => {
      const layer = Math.random(); // 0..1 глубина параллакса
      const isCrystal = (effect === 'snowfall' || effect === 'blizzard' || effect === 'aurora_snow') && layer > 0.52;
      const isBlizzard = effect === 'blizzard';
      const isSparks = effect === 'champagne_sparks';
      const isStars = effect === 'stardust';

      const size = isCrystal
        ? 4.2 + layer * 5.8
        : isSparks
          ? 2.2 + layer * 4.5
          : isStars
            ? 1.1 + layer * 2.4
            : 1.4 + layer * 3.1;

      return {
        x: Math.random() * width,
        y: initial ? Math.random() * height : (isSparks ? height + 14 : -16),
        size,
        layer,
        isCrystal,
        vy: isStars
          ? 0.04 + layer * 0.1
          : isSparks
            ? -(0.35 + layer * 0.85)
            : (isBlizzard ? 1.35 + layer * 2.3 : 0.42 + layer * 1.15),
        vx: isBlizzard
          ? 1.1 + layer * 1.9
          : (Math.random() - 0.5) * 0.35,
        swayAmp: 0.3 + layer * 0.85,
        swayFreq: 0.008 + Math.random() * 0.014,
        phase: Math.random() * Math.PI * 2,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.018,
        alpha: isStars ? 0.22 + Math.random() * 0.55 : 0.16 + layer * 0.38,
        color: sparkColors[Math.floor(Math.random() * sparkColors.length)],
      };
    };

    const particles = Array.from({ length: count }, () => createParticle(true));
    let tick = 0;

    const renderFrame = () => {
      if (paused) return;
      tick += 1;
      ctx.clearRect(0, 0, width, height);

      // Мягкие волны Северного сияния в верхней части неба для режима aurora_snow
      if (effect === 'aurora_snow') {
        const shift1 = Math.sin(tick * 0.008) * (width * 0.14);
        const shift2 = Math.cos(tick * 0.006) * (width * 0.16);

        const g1 = ctx.createRadialGradient(
          width * 0.28 + shift1, height * 0.06, 10,
          width * 0.28 + shift1, height * 0.14, Math.max(width, height) * 0.52
        );
        g1.addColorStop(0, 'rgba(16, 185, 129, 0.16)');
        g1.addColorStop(0.5, 'rgba(56, 189, 248, 0.09)');
        g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, width, height * 0.65);

        const g2 = ctx.createRadialGradient(
          width * 0.74 + shift2, height * 0.08, 10,
          width * 0.74 + shift2, height * 0.18, Math.max(width, height) * 0.48
        );
        g2.addColorStop(0, 'rgba(168, 85, 247, 0.15)');
        g2.addColorStop(0.55, 'rgba(99, 102, 241, 0.08)');
        g2.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, width, height * 0.65);
      }

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.phase += p.swayFreq;
        p.x += p.vx + Math.sin(p.phase) * p.swayAmp;
        p.y += p.vy;
        p.rot += p.vRot;

        if (effect === 'champagne_sparks') {
          if (p.y < -18) Object.assign(p, createParticle(false));
        } else if (p.y > height + 18) {
          p.y = -14;
          p.x = Math.random() * width;
        }
        if (p.x > width + 18) p.x = -14;
        if (p.x < -18) p.x = width + 14;

        ctx.save();
        ctx.translate(p.x, p.y);

        if (p.isCrystal) {
          ctx.rotate(p.rot);
          ctx.strokeStyle = effect === 'blizzard'
            ? `rgba(186, 230, 253, ${p.alpha.toFixed(2)})`
            : `rgba(241, 245, 249, ${p.alpha.toFixed(2)})`;
          ctx.lineWidth = p.size > 7 ? 1.25 : 1;
          ctx.lineCap = 'round';
          drawCrystalSnowflake(ctx, p.size);
        } else if (effect === 'champagne_sparks') {
          const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(p.phase * 1.8));
          ctx.rotate(p.rot * 0.5);
          ctx.globalAlpha = p.alpha * twinkle;
          ctx.fillStyle = p.color;
          drawSparkleStar(ctx, p.size);
        } else if (effect === 'stardust') {
          const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(p.phase * 2.2));
          ctx.globalAlpha = p.alpha * twinkle;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Мягкая снежинка-хлопья с лёгким ореолом
          const rad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size * 1.45);
          rad.addColorStop(0, `rgba(255, 255, 255, ${p.alpha.toFixed(2)})`);
          rad.addColorStop(0.55, `rgba(224, 242, 254, ${(p.alpha * 0.55).toFixed(2)})`);
          rad.addColorStop(1, 'rgba(224, 242, 254, 0)');
          ctx.fillStyle = rad;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 1.45, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      rafId = window.requestAnimationFrame(renderFrame);
    };

    const onVisibility = () => {
      paused = document.hidden;
      if (!paused) {
        window.cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    rafId = window.requestAnimationFrame(renderFrame);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [effect, density, animationsOn]);

  return html`<div class="atmosphere-root" aria-hidden="true">
    ${garlandOn && html`<${FestiveGarland} styleId=${garlandStyle} />`}
    ${animationsOn && effect !== 'none' && html`<canvas ref=${canvasRef} class="atmosphere-canvas"></canvas>`}
  </div>`;
}
