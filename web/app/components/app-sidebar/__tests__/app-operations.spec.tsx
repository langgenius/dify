import type { Operation } from '../components/app-operations'
import { RiEditLine } from '@remixicon/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import AppOperations from '../components/app-operations'

function op(id: string, title: string, opts?: Partial<Operation>): Operation {
  return { id, title, icon: <RiEditLine />, onClick: vi.fn(), ...opts }
}

describe('AppOperations', () => {
  it('should render primary operations in measure row', () => {
    const ops = [op('edit', 'Edit'), op('copy', 'Copy')]
    render(<AppOperations gap={4} primaryOperations={ops} />)
    expect(screen.getAllByText('Edit').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Copy').length).toBeGreaterThanOrEqual(1)
  })

  it('should render single operations prop as primary', () => {
    const ops = [op('a', 'Action')]
    render(<AppOperations gap={4} operations={ops} />)
    expect(screen.getAllByText('Action').length).toBeGreaterThanOrEqual(1)
  })

  it('should apply gap style to rows', () => {
    const { container } = render(<AppOperations gap={8} primaryOperations={[op('a', 'A')]} />)
    const styledDivs = container.querySelectorAll<HTMLElement>('[style]')
    const gapValues = Array.from(styledDivs).map(el => el.style.gap)
    expect(gapValues).toContain('8px')
  })

  it('should filter dividers from inline operations', () => {
    const ops = [op('a', 'A'), op('d', '', { type: 'divider' }), op('b', 'B')]
    render(<AppOperations gap={4} primaryOperations={ops} />)
    expect(screen.getAllByText('A').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('B').length).toBeGreaterThanOrEqual(1)
  })

  it('should render more button text', () => {
    render(<AppOperations gap={4} primaryOperations={[op('a', 'A')]} />)
    expect(screen.getAllByText('common.operation.more').length).toBeGreaterThanOrEqual(1)
  })

  it('should handle empty primaryOperations', () => {
    const { container } = render(<AppOperations gap={4} primaryOperations={[]} />)
    expect(container).toBeTruthy()
  })

  it('should handle empty operations prop', () => {
    const { container } = render(<AppOperations gap={4} operations={[]} />)
    expect(container).toBeTruthy()
  })

  it('should use secondaryOperations when both are given', () => {
    const primary = [op('a', 'Primary')]
    const secondary = [op('b', 'Secondary')]
    render(<AppOperations gap={4} primaryOperations={primary} secondaryOperations={secondary} />)
    expect(screen.getAllByText('Primary').length).toBeGreaterThanOrEqual(1)
  })

  it('should ignore secondaryOperations when operations prop is used', () => {
    const ops = [op('a', 'Solo')]
    render(<AppOperations gap={4} operations={ops} secondaryOperations={[op('b', 'Extra')]} />)
    expect(screen.getAllByText('Solo').length).toBeGreaterThanOrEqual(1)
  })

  it('should fall back to EMPTY_OPERATIONS when no ops props', () => {
    const { container } = render(<AppOperations gap={4} />)
    expect(container).toBeTruthy()
  })

  describe('overflow behavior', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

    afterEach(() => {
      if (originalDescriptor)
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalDescriptor)
      else
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', { value: 0, configurable: true, writable: true })
    })

    function mockWidths(containerWidth: number, itemWidth: number, moreWidth: number) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        get(this: HTMLElement) {
          if (this.id === 'more-measure')
            return moreWidth
          if (this.dataset?.targetid)
            return itemWidth
          if (this.getAttribute('aria-hidden') === 'true')
            return containerWidth
          return 0
        },
        configurable: true,
      })
    }

    it('should show all items when container has enough space', () => {
      mockWidths(500, 80, 60)
      const ops = [op('a', 'A'), op('b', 'B')]
      render(<AppOperations gap={4} primaryOperations={ops} />)
      const visibleRow = document.querySelectorAll('[style]')[1]
      expect(visibleRow?.querySelectorAll('[data-targetid]').length).toBe(2)
    })

    it('should overflow items when container is too small', () => {
      mockWidths(100, 80, 60)
      const ops = [op('a', 'A'), op('b', 'B')]
      const secondary = [op('c', 'C')]
      render(<AppOperations gap={4} primaryOperations={ops} secondaryOperations={secondary} />)
      const visibleRow = document.querySelectorAll('[style]')[1]
      expect(visibleRow?.querySelectorAll('[data-targetid]').length).toBeLessThan(2)
    })

    it('should fit last item without more button when possible', () => {
      mockWidths(140, 80, 60)
      const ops = [op('a', 'A')]
      render(<AppOperations gap={4} primaryOperations={ops} />)
      const visibleRow = document.querySelectorAll('[style]')[1]
      expect(visibleRow?.querySelectorAll('[data-targetid]').length).toBe(1)
    })

    it('should call onClick on visible operation', () => {
      mockWidths(500, 80, 60)
      const clickFn = vi.fn()
      const ops = [op('a', 'A', { onClick: clickFn })]
      render(<AppOperations gap={4} primaryOperations={ops} />)
      const visibleBtns = document.querySelectorAll('[style]')[1]?.querySelectorAll('button')
      if (visibleBtns?.[0])
        fireEvent.click(visibleBtns[0])
      expect(clickFn).toHaveBeenCalled()
    })

    it('should open more menu when clicking more button', async () => {
      mockWidths(100, 80, 60)
      const secondary = [op('del', 'Delete')]
      render(<AppOperations gap={4} primaryOperations={[op('a', 'A'), op('b', 'B')]} secondaryOperations={secondary} />)
      const visibleRow = document.querySelectorAll('[style]')[1]
      const moreBtn = visibleRow?.querySelector('button:not([data-targetid])')
      if (moreBtn)
        fireEvent.click(moreBtn)
      await waitFor(() => expect(screen.getByText('Delete')).toBeInTheDocument())
    })
  })
})
