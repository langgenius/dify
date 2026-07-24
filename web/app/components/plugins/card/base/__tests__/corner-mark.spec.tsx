import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CornerMark from '../corner-mark'

vi.mock('../../../../base/icons/src/vender/plugin', () => ({
  LeftCorner: ({ className }: { className: string }) => <svg data-testid="left-corner" className={className} />,
}))

describe('CornerMark', () => {
  it('renders the text content', () => {
    render(<CornerMark text="NEW" />)
    expect(screen.getByText('NEW')).toBeInTheDocument()
  })

  it('renders the LeftCorner icon', () => {
    render(<CornerMark text="BETA" />)
    expect(screen.getByTestId('left-corner')).toBeInTheDocument()
  })

  it('renders with absolute positioning', () => {
    const { container } = render(<CornerMark text="TAG" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('absolute')
    expect(wrapper.className).toContain('right-0')
    expect(wrapper.className).toContain('top-0')
  })
})
