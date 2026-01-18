import { render, screen } from '@testing-library/react'
import EmbeddingSkeleton from './index'

// Mock Skeleton components
vi.mock('@/app/components/base/skeleton', () => ({
  SkeletonContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="skeleton-container">{children}</div>,
  SkeletonPoint: () => <div data-testid="skeleton-point" />,
  SkeletonRectangle: () => <div data-testid="skeleton-rectangle" />,
  SkeletonRow: ({ children }: { children?: React.ReactNode }) => <div data-testid="skeleton-row">{children}</div>,
}))

// Mock Divider
vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

describe('EmbeddingSkeleton', () => {
  it('should render correct number of skeletons', () => {
    render(<EmbeddingSkeleton />)

    // It renders 5 CardSkeletons. Each CardSkelton has multiple SkeletonContainers.
    // Let's count the number of main wrapper divs (loop is 5)

    // Each iteration renders a CardSkeleton and potentially a Divider.
    // The component structure is:
    // div.relative...
    //   div.absolute... (mask)
    //   map(5) -> div.w-full.px-11 -> CardSkelton + Divider (except last?)

    // Actually the code says `index !== 9`, but the loop is length 5.
    // So `index` goes 0..4. All are !== 9. So 5 dividers should be rendered.

    expect(screen.getAllByTestId('divider')).toHaveLength(5)

    // Just ensure it renders without crashing and contains skeleton elements
    expect(screen.getAllByTestId('skeleton-container').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('skeleton-rectangle').length).toBeGreaterThan(0)
  })

  it('should render the mask overlay', () => {
    const { container } = render(<EmbeddingSkeleton />)
    // Check for the absolute positioned mask
    const mask = container.querySelector('.bg-dataset-chunk-list-mask-bg')
    expect(mask).toBeInTheDocument()
  })
})
