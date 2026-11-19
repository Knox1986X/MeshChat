/**
 * Генерация исходников иконок и сплэшей для Android.
 * Запуск: node scripts/make-assets.mjs
 * Затем: npx capacitor-assets generate --android
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'

const OUT = 'resources'

const logo = (opacity = 1) => `
  <g stroke="#ffffff" fill="none" stroke-linejoin="round" opacity="${opacity}">
    <polygon points="50,13 82,31.5 82,68.5 50,87 18,68.5 18,31.5" stroke-width="2.6"/>
    <polygon points="50,19 76.5,34.3 76.5,65.7 50,81 23.5,65.7 23.5,34.3" stroke-width="2.2"/>
    <g stroke-width="1" opacity="0.85">
      <line x1="50" y1="19" x2="50" y2="30"/>
      <line x1="76.5" y1="34.3" x2="65" y2="41"/>
      <line x1="23.5" y1="34.3" x2="35" y2="41"/>
      <line x1="76.5" y1="65.7" x2="65" y2="59"/>
      <line x1="23.5" y1="65.7" x2="35" y2="59"/>
      <line x1="50" y1="81" x2="50" y2="74"/>
    </g>
  </g>
  <g fill="#ffffff">
    <path d="M50 31c-7.2 0-13 5.4-13 12.2 0 4.4 2.3 7.3 4.1 10.2.9 1.5 1.4 2.6 1.6 4.1h14.6c.2-1.5.7-2.6 1.6-4.1 1.8-2.9 4.1-5.8 4.1-10.2C63 36.4 57.2 31 50 31z"/>
    <rect x="43.5" y="59.5" width="13" height="2.8" rx="1.2"/>
    <rect x="44" y="64" width="12" height="6.5" rx="2"/>
  </g>`

const gradient = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8B7BF8"/>
      <stop offset="0.55" stop-color="#6C5DF0"/>
      <stop offset="1" stop-color="#4F42D8"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.3" r="0.62">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" fill="url(#g)"/>
  <rect width="100" height="100" fill="url(#glow)"/>`

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  ${gradient}
  <g transform="translate(50 50) scale(0.86) translate(-50 -50)">${logo()}</g>
</svg>`

const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g transform="translate(50 50) scale(0.58) translate(-50 -50)">${logo()}</g>
</svg>`

const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${gradient}</svg>`

const splashSvg = (dark) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <radialGradient id="sg" cx="0.5" cy="0.38" r="0.72">
      <stop offset="0" stop-color="${dark ? '#1b2a5e' : '#16224a'}"/>
      <stop offset="0.55" stop-color="${dark ? '#0c1330' : '#101a3c'}"/>
      <stop offset="1" stop-color="#070b1a"/>
    </radialGradient>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8B7BF8"/>
      <stop offset="1" stop-color="#4F42D8"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#sg)"/>
  <circle cx="50" cy="48" r="17" fill="#6C5DF0" opacity="0.14"/>
  <rect x="42.5" y="40.5" width="15" height="15" rx="3.6" fill="url(#lg)"/>
  <g transform="translate(50 48) scale(0.13) translate(-50 -50)">${logo()}</g>
</svg>`

const write = async (name, svg, size) => {
  const buf = await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer()
  await writeFile(`${OUT}/${name}`, buf)
  console.log(`✓ ${OUT}/${name} — ${size}×${size}, ${(buf.length / 1024).toFixed(0)} КБ`)
}

await mkdir(OUT, { recursive: true })
await write('icon.png', iconSvg, 1024)
await write('icon-foreground.png', foregroundSvg, 1024)
await write('icon-background.png', backgroundSvg, 1024)
await write('splash.png', splashSvg(false), 2732)
await write('splash-dark.png', splashSvg(true), 2732)
console.log('\nГотово. Дальше: npx capacitor-assets generate --android')
