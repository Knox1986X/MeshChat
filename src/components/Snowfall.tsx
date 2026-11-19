import { useMemo } from 'react'

function Snowflake({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ opacity }}>
      <g stroke="#dbeafe" strokeWidth="1.6" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="3.3" y1="7" x2="20.7" y2="17" />
        <line x1="20.7" y1="7" x2="3.3" y2="17" />
      </g>
      <g stroke="#dbeafe" strokeWidth="1.3" strokeLinecap="round" fill="none">
        <path d="M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5" />
        <path d="M3.3 7l3.4.6M3.3 7l.6 3.4M20.7 17l-3.4-.6M20.7 17l-.6-3.4" />
        <path d="M20.7 7l-3.4.6M20.7 7l-.6 3.4M3.3 17l3.4-.6M3.3 17l.6-3.4" />
      </g>
    </svg>
  )
}

/** Falling snowflakes overlay (New-Year theme) */
export default function Snowfall({ count = 34 }: { count?: number }) {
  const flakes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: (i * 37.7 + 13) % 100,
        size: 9 + ((i * 11) % 16),
        duration: 11 + ((i * 7) % 14),
        delay: -((i * 3.1) % 18),
        opacity: 0.25 + ((i * 13) % 10) / 22,
        sway: 3 + (i % 5),
      })),
    [count],
  )

  return (
    <div className="pointer-events-none fixed inset-0 z-20 overflow-hidden" aria-hidden>
      {flakes.map(f => (
        <span
          key={f.id}
          className="absolute top-0"
          style={{
            left: `${f.left}%`,
            animation: `snowFall ${f.duration}s linear ${f.delay}s infinite`,
          }}
        >
          <span
            className="block"
            style={{ animation: `snowSway ${f.sway}s ease-in-out infinite` }}
          >
            <Snowflake size={f.size} opacity={f.opacity} />
          </span>
        </span>
      ))}
    </div>
  )
}
