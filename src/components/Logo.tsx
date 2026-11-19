interface Props {
  size?: number
  rounded?: boolean
}

/** MeshChat logo: lightbulb in double hexagon, like the reference icon */
export default function Logo({ size = 44, rounded = true }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0">
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7B6CF5" />
          <stop offset="1" stopColor="#5B4FE0" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx={rounded ? 22 : 0} fill="url(#logo-bg)" />
      <polygon points="50,13 82,31.5 82,68.5 50,87 18,68.5 18,31.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" opacity="0.95" />
      <polygon points="50,19 76.5,34.3 76.5,65.7 50,81 23.5,65.7 23.5,34.3" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      <g stroke="#fff" strokeWidth="1" opacity="0.85">
        <line x1="50" y1="19" x2="50" y2="30" />
        <line x1="76.5" y1="34.3" x2="65" y2="41" />
        <line x1="23.5" y1="34.3" x2="35" y2="41" />
        <line x1="76.5" y1="65.7" x2="65" y2="59" />
        <line x1="23.5" y1="65.7" x2="35" y2="59" />
        <line x1="50" y1="81" x2="50" y2="74" />
      </g>
      <path d="M50 31c-7.2 0-13 5.4-13 12.2 0 4.4 2.3 7.3 4.1 10.2.9 1.5 1.4 2.6 1.6 4.1h14.6c.2-1.5.7-2.6 1.6-4.1 1.8-2.9 4.1-5.8 4.1-10.2C63 36.4 57.2 31 50 31z" fill="#fff" />
      <rect x="43.5" y="59.5" width="13" height="2.8" rx="1.2" fill="#fff" />
      <rect x="44" y="64" width="12" height="6.5" rx="2" fill="#fff" />
    </svg>
  )
}
