import { fireEvent, render, screen } from '@testing-library/react'
import { FieldTitle } from '../field-title'

vi.mock('@/app/components/base/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('FieldTitle', () => {
  it('should render title, subtitle, operation, tooltip and warning dot', () => {
    render(
      <FieldTitle
        title="Embedding"
        subTitle={<div>subtitle</div>}
        operation={<button type="button">action</button>}
        tooltip="Tooltip copy"
        warningDot
      />,
    )

    expect(screen.getByText('Embedding')).toBeInTheDocument()
    expect(screen.getByText('subtitle')).toBeInTheDocument()
    expect(screen.getByText('Tooltip copy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'action' })).toBeInTheDocument()
    expect(document.querySelector('.bg-text-warning-secondary')).not.toBeNull()
  })

  it('should toggle local collapsed state and notify onCollapse when enabled', () => {
    const onCollapse = vi.fn()
    const { container } = render(
      <FieldTitle
        title="Models"
        showArrow
        onCollapse={onCollapse}
      />,
    )

    const header = screen.getByText('Models').closest('.group\\/collapse')
    const arrow = container.querySelector('[aria-hidden="true"]')

    expect(arrow).toHaveClass('rotate-[270deg]')

    fireEvent.click(header!)

    expect(onCollapse).toHaveBeenCalledWith(false)
    expect(arrow).not.toHaveClass('rotate-[270deg]')
  })

  it('should respect controlled collapsed state and ignore clicks when disabled', () => {
    const onCollapse = vi.fn()
    const { container } = render(
      <FieldTitle
        title="Controlled"
        showArrow
        collapsed={false}
        disabled
        onCollapse={onCollapse}
      />,
    )

    fireEvent.click(screen.getByText('Controlled').closest('.group\\/collapse')!)

    expect(onCollapse).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-hidden="true"]')).not.toHaveClass('rotate-[270deg]')
  })
})
