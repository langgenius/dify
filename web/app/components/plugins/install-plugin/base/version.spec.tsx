import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/components/base/badge/index', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
  BadgeState: { Default: 'default', Warning: 'warning' },
}))

describe('Version', () => {
  let Version: (typeof import('./version'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./version')
    Version = mod.default
  })

  it('should show simple version badge for new install', () => {
    render(<Version hasInstalled={false} toInstallVersion="1.0.0" />)

    expect(screen.getByTestId('badge')).toHaveTextContent('1.0.0')
  })

  it('should show upgrade version badge for existing install', () => {
    render(
      <Version
        hasInstalled={true}
        installedVersion="1.0.0"
        toInstallVersion="2.0.0"
      />,
    )

    expect(screen.getByTestId('badge')).toHaveTextContent('1.0.0 -> 2.0.0')
  })

  it('should handle downgrade version display', () => {
    render(
      <Version
        hasInstalled={true}
        installedVersion="2.0.0"
        toInstallVersion="1.0.0"
      />,
    )

    expect(screen.getByTestId('badge')).toHaveTextContent('2.0.0 -> 1.0.0')
  })
})
