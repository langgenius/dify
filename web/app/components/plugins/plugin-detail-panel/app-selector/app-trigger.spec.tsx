import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@remixicon/react', () => ({
  RiArrowDownSLine: () => <span data-testid="chevron-icon" />,
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ size }: { size: string }) => <div data-testid="app-icon" data-size={size} />,
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

describe('AppTrigger', () => {
  let AppTrigger: (typeof import('./app-trigger'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./app-trigger')
    AppTrigger = mod.default
  })

  it('should render placeholder when no app is selected', () => {
    render(<AppTrigger open={false} />)

    expect(screen.queryByTestId('app-icon')).not.toBeInTheDocument()
    expect(screen.getByTestId('chevron-icon')).toBeInTheDocument()
  })

  it('should render app details when appDetail is provided', () => {
    const appDetail = {
      name: 'My App',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#fff',
    }
    render(<AppTrigger open={false} appDetail={appDetail as never} />)

    expect(screen.getByTestId('app-icon')).toBeInTheDocument()
    expect(screen.getByText('My App')).toBeInTheDocument()
  })

  it('should show chevron icon', () => {
    render(<AppTrigger open={true} />)

    expect(screen.getByTestId('chevron-icon')).toBeInTheDocument()
  })
})
