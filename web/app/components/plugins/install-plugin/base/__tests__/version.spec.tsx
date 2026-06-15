import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Version', () => {
  let Version: (typeof import('../version'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../version')
    Version = mod.default
  })

  it('should show simple version badge for new install', () => {
    render(<Version hasInstalled={false} toInstallVersion="1.0.0" />)

    expect(screen.getByText('1.0.0')).toBeInTheDocument()
  })

  it('should show upgrade version badge for existing install', () => {
    render(
      <Version
        hasInstalled={true}
        installedVersion="1.0.0"
        toInstallVersion="2.0.0"
      />,
    )

    expect(screen.getByText('1.0.0 -> 2.0.0')).toBeInTheDocument()
  })

  it('should handle downgrade version display', () => {
    render(
      <Version
        hasInstalled={true}
        installedVersion="2.0.0"
        toInstallVersion="1.0.0"
      />,
    )

    expect(screen.getByText('2.0.0 -> 1.0.0')).toBeInTheDocument()
  })
})
