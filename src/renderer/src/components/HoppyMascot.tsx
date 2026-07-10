/**
 * Hoppy 마스코트 — 플레이스홀더 SVG(로고 확정 전 대체 예정). Welcome 히어로(#80)와
 * 라이브러리 빈 상태(#78)가 함께 쓴다.
 */
export function HoppyMascot({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-label="Hoppy 마스코트">
      <ellipse cx="60" cy="104" rx="34" ry="7" fill="#000" opacity="0.28" />
      <path
        d="M60 30c26 0 40 20 40 44 0 20-16 30-40 30S20 94 20 74c0-24 14-44 40-44z"
        fill="#4cc93f"
      />
      <path
        d="M60 30c26 0 40 20 40 44 0 6-1.4 11-4 15-6-30-30-40-52-38 4-13 15-21 16-21z"
        fill="#5cd94e"
        opacity=".6"
      />
      <ellipse cx="60" cy="82" rx="22" ry="20" fill="#0a1f0c" opacity=".14" />
      <circle cx="42" cy="34" r="15" fill="#4cc93f" />
      <circle cx="78" cy="34" r="15" fill="#4cc93f" />
      <circle cx="42" cy="34" r="10" fill="#f2f6ee" />
      <circle cx="78" cy="34" r="10" fill="#f2f6ee" />
      <circle cx="45" cy="36" r="5" fill="#0a1f0c" />
      <circle cx="75" cy="36" r="5" fill="#0a1f0c" />
      <circle cx="47" cy="34" r="1.6" fill="#fff" />
      <circle cx="77" cy="34" r="1.6" fill="#fff" />
      <path d="M46 74q14 12 28 0" stroke="#0a1f0c" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <circle cx="36" cy="66" r="5" fill="#5cd94e" opacity=".5" />
      <circle cx="84" cy="66" r="5" fill="#5cd94e" opacity=".5" />
    </svg>
  )
}
