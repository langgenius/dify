'use client'

import type { ReactNode } from 'react'

type IntegrationSectionLayoutProps = {
  bodyClassName?: string
  children: ReactNode
  label?: string
}

export function IntegrationSectionLayout({
  bodyClassName,
  children,
  label,
}: IntegrationSectionLayoutProps) {
  return (
    <div
      aria-label={label}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain max-md:min-h-48"
      role={label ? 'region' : undefined}
    >
      <div className={bodyClassName}>{children}</div>
    </div>
  )
}
