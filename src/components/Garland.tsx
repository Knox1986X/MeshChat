import { useMemo } from 'react'

const COLORS = ['#67e8f9', '#f8fafc', '#c4b5fd', '#93c5fd', '#67e8f9', '#e0e7ff', '#a5b4fc', '#f8fafc']

/** New-Year string lights across the top, like in the reference screenshots */
export default function Garland() {
  const bulbs = useMemo(() => {
    const arr: { x: number; y: number; c: string; d: number; r: number }[] = []
    const n = 16
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const x = 4 + t * 92
      const y = 6 + Math.sin(t * Math.PI * 2.2) * 3.2 + t * 2
      arr.push({ x, y, c: COLORS[i % COLORS.length], d: (i % 5) * 0.35, r: 1.5 + ((i * 7) % 3) * 0.35 })
    }
    return arr
  }, [])

  return (
    <div className="pointer-events-none absolute top-0 inset-x-0 z-30 overflow-hidden" aria-hidden>
      <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="w-full h-[54px] block">
        <defs>
          <filter id="bulb-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.1" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* wire */}
        <path d="M0 4 Q 25 11 50 6 T 100 5" fill="none" stroke="rgba(148,163,216,.35)" strokeWidth="0.45" />
        {/* scallops */}
        <path d="M0 4 q6 5 12 1 q6 5 12 1 q6 5 12 1 q6 5 12 1 q6 5 12 1 q6 5 12 1 q6 5 12 1 q6 5 16 0" fill="none" stroke="rgba(148,163,216,.22)" strokeWidth="0.4" />
        {bulbs.map((b, i) => (
          <g key={i} filter="url(#bulb-glow)" style={{ animation: `bulbGlow 2.4s ease-in-out ${b.d}s infinite` }}>
            <line x1={b.x} y1={b.y - 1.6} x2={b.x} y2={b.y} stroke="rgba(200,210,255,.5)" strokeWidth="0.35" />
            <circle cx={b.x} cy={b.y + b.r} r={b.r} fill={b.c} />
          </g>
        ))}
      </svg>
    </div>
  )
}
