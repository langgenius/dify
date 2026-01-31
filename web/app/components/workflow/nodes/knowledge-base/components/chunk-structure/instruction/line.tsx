import * as React from 'react'

type LineProps = {
  type?: 'vertical' | 'horizontal'
  className?: string
}

const Line = ({
  type = 'vertical',
  className,
}: LineProps) => {
  if (type === 'vertical') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="2" height="132" viewBox="0 0 2 132" fill="none" className={className}>
        <path d="M1 0L1 132" stroke="url(#paint0_linear_10882_18766)" />
        <defs>
          <linearGradient id="paint0_linear_10882_18766" x1="-7.99584" y1="132" x2="-7.96108" y2="6.4974e-07" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--color-background-gradient-mask-transparent)" />
            <stop offset="0.877606" stopColor="var(--color-divider-subtle)" />
            <stop offset="1" stopColor="var(--color-background-gradient-mask-transparent)" />
          </linearGradient>
        </defs>
      </svg>
    )
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="2" viewBox="0 0 240 2" fill="none" className={className}>
      <path d="M0 1H240" stroke="url(#paint0_linear_10882_18763)" />
      <defs>
        <linearGradient id="paint0_linear_10882_18763" x1="240" y1="9.99584" x2="3.95539e-05" y2="9.88094" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-background-gradient-mask-transparent)" />
          <stop offset="0.9031" stopColor="var(--color-divider-subtle)" />
          <stop offset="1" stopColor="var(--color-background-gradient-mask-transparent)" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default React.memo(Line)
