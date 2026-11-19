import { useState } from 'react'
import { Globe, RefreshCw, Wifi } from 'lucide-react'
import { MESH_NODES, MESH_PLUGINS } from '../../lib/data'

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-[52px] h-[30px] rounded-full p-1 transition-all shrink-0 ${on ? 'bg-sky-500' : 'bg-slate-600/60'}`}>
      <span className={`block w-[22px] h-[22px] rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : ''}`} />
    </button>
  )
}

export default function MeshScreen() {
  const [plugins, setPlugins] = useState(MESH_PLUGINS)
  const [scanning, setScanning] = useState(true)
  const [latency, setLatency] = useState(173)

  const rescan = () => {
    setScanning(true)
    setLatency(120 + Math.floor(Math.random() * 120))
    setTimeout(() => setScanning(false), 2500)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-5 pt-14 pb-3 shrink-0 flex items-start justify-between">
        <div>
          <h1 className="text-[30px] font-extrabold tracking-tight">Mesh</h1>
          <div className="flex items-center gap-2 mt-3">
            <span className="inline-flex items-center gap-2 bg-emerald-400/10 border border-emerald-400/25 text-emerald-300 text-[12.5px] font-bold px-3.5 py-2 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-400 blink-dot" />
              {scanning ? 'сканирование' : 'на связи'}
            </span>
            <span className="bg-white/[.06] border border-white/[.07] text-slate-300 text-[12.5px] font-bold px-3.5 py-2 rounded-full">
              {MESH_NODES.length} узлов · {plugins.filter(p => p.enabled).length} плагинов
            </span>
          </div>
        </div>
        <button onClick={rescan} className="w-11 h-11 rounded-2xl card flex items-center justify-center text-slate-300 shrink-0" title="Пересканировать">
          <RefreshCw size={19} className={scanning ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scroll-slim px-4 pb-28 md:pb-6">
        {/* Radar */}
        <div className="card p-4 mb-5 overflow-hidden">
          <div className="relative aspect-square max-h-[320px] mx-auto">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <defs>
                <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(56,189,248,.10)" />
                  <stop offset="100%" stopColor="rgba(56,189,248,0)" />
                </radialGradient>
                <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgba(56,189,248,.5)" />
                  <stop offset="100%" stopColor="rgba(56,189,248,0)" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="48" fill="url(#radar-bg)" />
              {[14, 26, 38, 48].map(r => (
                <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgba(148,163,216,.18)" strokeWidth="0.5" />
              ))}
              <line x1="50" y1="2" x2="50" y2="98" stroke="rgba(148,163,216,.12)" strokeWidth="0.5" />
              <line x1="2" y1="50" x2="98" y2="50" stroke="rgba(148,163,216,.12)" strokeWidth="0.5" />
              {/* sweep */}
              <g className="radar-sweep" style={{ transformOrigin: '50px 50px' }}>
                <path d="M50 50 L98 50 A48 48 0 0 0 74 8 Z" fill="url(#sweep)" opacity="0.7" />
                <line x1="50" y1="50" x2="98" y2="50" stroke="rgba(125,211,252,.8)" strokeWidth="0.8" />
              </g>
              {/* nodes */}
              {MESH_NODES.map(n => (
                <g key={n.id}>
                  <circle cx={n.x} cy={n.y} r="2.6" fill={n.color} />
                  <circle cx={n.x} cy={n.y} r="5" fill="none" stroke={n.color} strokeWidth="0.6" opacity="0.5" />
                </g>
              ))}
            </svg>
            {/* center */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/50">
              <Wifi size={28} className="text-white" />
            </div>
            {/* node labels */}
            <span className="absolute bg-[#0d1430]/90 border border-white/10 text-[10.5px] font-bold px-2 py-1 rounded-lg whitespace-nowrap" style={{ left: '8%', top: '26%' }}>
              @mixik · X3DH
            </span>
            <span className="absolute bg-[#0d1430]/90 border border-white/10 text-[10.5px] font-bold px-2 py-1 rounded-lg whitespace-nowrap" style={{ right: '4%', top: '22%' }}>
              Blind Relay · {latency} мс
            </span>
          </div>
          <p className="text-center text-[13.5px] text-slate-400 mt-2">
            Активный транспорт: <b className="text-slate-200">WS</b> · задержка <b className="text-sky-300">{latency} мс</b>
          </p>
        </div>

        <p className="text-[11.5px] font-extrabold tracking-[.14em] text-slate-500 px-2 mb-2">ТРАНСПОРТНЫЕ ПЛАГИНЫ</p>
        <div className="space-y-2">
          {plugins.map(p => (
            <div key={p.id} className="card card-hover p-4 flex items-center gap-3.5">
              <span
                className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: p.iconBg, color: p.iconColor }}
              >
                {p.id === 'tor' ? <Globe size={22} /> : <Wifi size={22} />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[15px] flex items-center gap-2 flex-wrap">
                  {p.name}
                  {p.badge && <span className="text-[9.5px] font-extrabold bg-amber-400/15 text-amber-300 px-2 py-0.5 rounded-full">{p.badge}</span>}
                </p>
                <p className="text-[12.5px] text-slate-400 leading-snug mt-0.5">{p.desc}</p>
              </div>
              <Toggle
                on={p.enabled}
                onClick={() => setPlugins(prev => prev.map(x => x.id === p.id ? { ...x, enabled: !x.enabled } : x))}
              />
            </div>
          ))}
        </div>

        <div className="card p-4 mt-5">
          <p className="font-bold text-[14.5px]">🛡 Автопереключение</p>
          <p className="text-[13px] text-slate-400 mt-1.5 leading-relaxed">
            Если основной транспорт заблокируют, MeshChat сам переключится на резервный — без VPN и ручных настроек.
            Cloudflare и Fly.io ключи подключаются позже.
          </p>
        </div>
      </div>
    </div>
  )
}
