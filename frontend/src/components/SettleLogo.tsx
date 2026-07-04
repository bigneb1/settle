interface Props { className?: string; collapsed?: boolean }

/**
 * Mark: three chain nodes of varying weight converge into a single point,
 * which resolves into a checkmark — cross-chain sources settling into one
 * completed payment. That's literally what the product does.
 */
export default function SettleLogo({ className = '', collapsed = false }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={collapsed ? '0 0 64 64' : '0 0 280 64'}
      fill="none"
      className={className}
    >
      <g>
        {/* Converging chain lines */}
        <line x1="3" y1="14" x2="30" y2="30" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" opacity="0.45"/>
        <line x1="3" y1="32" x2="30" y2="32" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
        <line x1="3" y1="50" x2="30" y2="34" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" opacity="0.45"/>

        {/* Source chain nodes */}
        <circle cx="3" cy="14" r="3" fill="hsl(var(--primary))" opacity="0.45"/>
        <circle cx="3" cy="32" r="3" fill="hsl(var(--primary))" opacity="0.7"/>
        <circle cx="3" cy="50" r="3" fill="hsl(var(--primary))" opacity="0.45"/>

        {/* Settlement halo */}
        <circle cx="32" cy="32" r="17" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" opacity="0.25"/>

        {/* Resolved checkmark */}
        <path
          d="M23 33 L30 41 L44 20"
          stroke="hsl(var(--primary))"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
      {!collapsed && (
        <>
          <text
            x="76" y="42"
            fontFamily="'JetBrains Mono', 'IBM Plex Mono', monospace"
            fontSize="28" fontWeight="700" letterSpacing="-0.5" fill="hsl(var(--foreground))"
          >settle</text>
          <text
            x="232" y="26"
            fontFamily="'Inter', sans-serif"
            fontSize="9" fontWeight="500" letterSpacing="1.5" fill="hsl(var(--primary))" opacity="0.8"
          >PAY</text>
        </>
      )}
    </svg>
  )
}
