type SelfHostedProps = {
  isActive: boolean
}

const SelfHosted = ({
  isActive,
}: SelfHostedProps) => {
  const color = isActive ? 'var(--color-saas-dify-blue-accessible)' : 'var(--color-text-primary)'

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="17" viewBox="0 0 16 17" fill="none">
      <g clipPath="url(#clip0_1_4644)">
        <rect opacity="0.18" y="0.5" width="4" height="4" rx="2" fill="var(--color-text-quaternary)" />
        <rect x="6" y="0.5" width="4" height="4" rx="2" fill={color} />
        <rect opacity="0.18" x="12" y="0.5" width="4" height="4" rx="2" fill="var(--color-text-quaternary)" />
        <rect y="6.5" width="4" height="4" rx="2" fill={color} />
        <rect opacity="0.18" x="6" y="6.5" width="4" height="4" rx="2" fill="var(--color-text-quaternary)" />
        <rect x="12" y="6.5" width="4" height="4" rx="2" fill={color} />
        <rect opacity="0.18" y="12.5" width="4" height="4" rx="2" fill="var(--color-text-quaternary)" />
        <rect x="6" y="12.5" width="4" height="4" rx="2" fill={color} />
        <rect opacity="0.18" x="12" y="12.5" width="4" height="4" rx="2" fill="var(--color-text-quaternary)" />
      </g>
      <defs>
        <clipPath id="clip0_1_4644">
          <rect width="16" height="16" fill="white" transform="translate(0 0.5)" />
        </clipPath>
      </defs>
    </svg>
  )
}

export default SelfHosted
