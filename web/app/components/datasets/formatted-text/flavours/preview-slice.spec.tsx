import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PreviewSlice } from './preview-slice'

vi.mock('@floating-ui/react', () => ({
  autoUpdate: vi.fn(),
  flip: vi.fn(),
  shift: vi.fn(),
  inline: vi.fn(),
  useFloating: () => ({
    refs: { setReference: vi.fn(), setFloating: vi.fn() },
    floatingStyles: {},
    context: { open: false, onOpenChange: vi.fn(), refs: { domReference: { current: null } }, nodeId: undefined },
  }),
  useHover: () => ({}),
  useDismiss: () => ({}),
  useRole: () => ({}),
  useInteractions: () => ({
    getReferenceProps: () => ({}),
    getFloatingProps: () => ({}),
  }),
}))

describe('PreviewSlice', () => {
  it('should render label and text', () => {
    render(<PreviewSlice label="P-1" text="preview content" tooltip="tooltip text" />)
    expect(screen.getByText('P-1')).toBeInTheDocument()
    expect(screen.getByText('preview content')).toBeInTheDocument()
  })

  it('should not show tooltip by default', () => {
    render(<PreviewSlice label="P-1" text="text" tooltip="tooltip" />)
    expect(screen.queryByText('tooltip')).not.toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(
      <PreviewSlice label="P-1" text="text" tooltip="tip" className="custom-class" />,
    )
    const sliceContainer = container.querySelector('.custom-class')
    expect(sliceContainer).toBeInTheDocument()
  })

  it('should apply labelInnerClassName', () => {
    render(<PreviewSlice label="Label" text="text" tooltip="tip" labelInnerClassName="inner-cls" />)
    expect(screen.getByText('Label')).toHaveClass('inner-cls')
  })

  it('should render divider', () => {
    const { container } = render(
      <PreviewSlice label="P-1" text="text" tooltip="tip" />,
    )
    const spans = container.querySelectorAll('span')
    const dividerSpan = Array.from(spans).find(s => s.textContent?.includes('\u200B'))
    expect(dividerSpan).toBeTruthy()
  })
})
