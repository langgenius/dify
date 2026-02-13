import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  SkeletonContainer,
  SkeletonPoint,
  SkeletonRectangle,
  SkeletonRow,
} from './index'

describe('Skeleton Components', () => {
  describe('Individual Components', () => {
    it('should forward attributes and render children in SkeletonContainer', () => {
      render(
        <SkeletonContainer data-testid="container" className="custom-container">
          <span>Content</span>
        </SkeletonContainer>,
      )
      const element = screen.getByTestId('container')
      expect(element).toHaveClass('flex', 'flex-col', 'custom-container')
      expect(screen.getByText('Content')).toBeInTheDocument()
    })

    it('should forward attributes and render children in SkeletonRow', () => {
      render(
        <SkeletonRow data-testid="row" className="custom-row">
          <span>Row Content</span>
        </SkeletonRow>,
      )
      const element = screen.getByTestId('row')
      expect(element).toHaveClass('flex', 'items-center', 'custom-row')
      expect(screen.getByText('Row Content')).toBeInTheDocument()
    })

    it('should apply base skeleton styles to SkeletonRectangle', () => {
      render(<SkeletonRectangle data-testid="rect" className="w-10" />)
      const element = screen.getByTestId('rect')
      expect(element).toHaveClass('h-2', 'bg-text-quaternary', 'opacity-20', 'w-10')
    })

    it('should render the separator character correctly in SkeletonPoint', () => {
      render(<SkeletonPoint data-testid="point" />)
      const element = screen.getByTestId('point')
      expect(element).toHaveTextContent('·')
      expect(element).toHaveClass('text-text-quaternary')
    })
  })

  describe('Composition & Layout', () => {
    it('should render a full skeleton structure accurately', () => {
      const { container } = render(
        <SkeletonContainer className="main-wrapper">
          <SkeletonRow>
            <SkeletonRectangle className="rect-1" />
            <SkeletonPoint />
            <SkeletonRectangle className="rect-2" />
          </SkeletonRow>
        </SkeletonContainer>,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('main-wrapper')

      expect(container.querySelector('.rect-1')).toBeInTheDocument()
      expect(container.querySelector('.rect-2')).toBeInTheDocument()

      const row = container.querySelector('.flex.items-center')
      expect(row).toContainElement(container.querySelector('.rect-1') as HTMLElement)
      expect(row).toHaveTextContent('·')
    })
  })

  it('should handle rest props like event listeners', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<SkeletonRectangle onClick={onClick} data-testid="clickable" />)

    const element = screen.getByTestId('clickable')

    await user.click(element)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
