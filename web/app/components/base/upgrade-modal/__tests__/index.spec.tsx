import type { SVGProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import UpgradeModalBase from '../index'

vi.mock('@/app/components/base/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode, open: boolean }) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: { children: React.ReactNode, className?: string }) => <div data-testid="dialog-content" className={className}>{children}</div>,
  DialogTitle: ({ children, className }: { children: React.ReactNode, className?: string }) => <h2 className={className}>{children}</h2>,
}))

const MockIcon = (props: SVGProps<SVGSVGElement>) => <svg data-testid="upgrade-icon" {...props} />

describe('UpgradeModalBase', () => {
  it('should render title, description, icon, extra info, and footer when visible', () => {
    render(
      <UpgradeModalBase
        Icon={MockIcon}
        title="Upgrade required"
        description="Please upgrade to continue."
        extraInfo={<div>Extra details</div>}
        footer={<button>Upgrade</button>}
        show
      />,
    )

    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('upgrade-icon')).toBeInTheDocument()
    expect(screen.getByText('Upgrade required')).toBeInTheDocument()
    expect(screen.getByText('Please upgrade to continue.')).toBeInTheDocument()
    expect(screen.getByText('Extra details')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
  })

  it('should not render when show is false', () => {
    render(
      <UpgradeModalBase
        title="Hidden"
        description="No modal"
        show={false}
      />,
    )

    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
  })

  it('should omit optional sections when icon, extraInfo, and footer are absent', () => {
    render(
      <UpgradeModalBase
        title="Basic modal"
        description="No extras"
        show
      />,
    )

    expect(screen.queryByTestId('upgrade-icon')).not.toBeInTheDocument()
    expect(screen.getByText('Basic modal')).toBeInTheDocument()
    expect(screen.getByText('No extras')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
