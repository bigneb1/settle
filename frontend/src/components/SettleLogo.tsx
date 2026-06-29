interface Props { className?: string; collapsed?: boolean }

export default function SettleLogo({ className = '', collapsed = false }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={collapsed ? '0 0 64 64' : '0 0 280 64'}
      fill="none"
      className={className}
    >
      {/* Mark: converging chain paths into single resolution node */}
      <g>
        <line x1="4" y1="20" x2="40" y2="32" stroke="#00d4aa" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
        <line x1="4" y1="32" x2="40" y2="32" stroke="#00d4aa" strokeWidth="1.5" strokeLinecap="round" opacity="0.75"/>
        <line x1="4" y1="44" x2="40" y2="32" stroke="#00d4aa" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
        <circle cx="4" cy="20" r="2.5" fill="#00d4aa" opacity="0.5"/>
        <circle cx="4" cy="32" r="2.5" fill="#00d4aa" opacity="0.75"/>
        <circle cx="4" cy="44" r="2.5" fill="#00d4aa" opacity="0.5"/>
        <circle cx="40" cy="32" r="5" fill="#00d4aa"/>
        <circle cx="40" cy="32" r="8" fill="none" stroke="#00d4aa" strokeWidth="1" opacity="0.3"/>
        <line x1="45" y1="32" x2="58" y2="32" stroke="#00d4aa" strokeWidth="1.5" strokeLinecap="round"/>
        <polygon points="56,28.5 62,32 56,35.5" fill="#00d4aa"/>
      </g>
      {!collapsed && (
        <>
          <text
            x="76" y="42"
            fontFamily="'JetBrains Mono', 'IBM Plex Mono', monospace"
            fontSize="28" fontWeight="700" letterSpacing="-0.5" fill="#e8e8e8"
          >settle</text>
          <text
            x="232" y="26"
            fontFamily="'Inter', sans-serif"
            fontSize="9" fontWeight="500" letterSpacing="1.5" fill="#00d4aa" opacity="0.8"
          >PAY</text>
        </>
      )}
    </svg>
  )
}
