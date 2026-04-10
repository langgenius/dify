import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import Loading from '../loading'

vi.mock('@/app/components/base/skeleton', () => ({
  SkeletonContainer: ({ children, className }: { children?: ReactNode, className?: string }) => (
    <div data-testid="skeleton-container" className={className}>{children}</div>
  ),
  SkeletonRectangle: ({ className }: { className?: string }) => (
    <div data-testid="skeleton-rectangle" className={className} />
  ),
}))

describe('CreateFromPipelinePreviewLoading', () => {
  it('should render the preview loading shell and all skeleton blocks', () => {
    const { container } = render(<Loading />)

    expect(container.firstElementChild).toHaveClass(
      'flex',
      'h-full',
      'w-full',
      'flex-col',
      'overflow-hidden',
      'px-6',
      'py-5',
    )
    expect(screen.getAllByTestId('skeleton-container')).toHaveLength(6)
    expect(screen.getAllByTestId('skeleton-rectangle')).toHaveLength(29)
  })
})
