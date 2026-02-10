import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/components/base/skeleton', () => ({
  SkeletonContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="skeleton-container">{children}</div>,
  SkeletonPoint: () => <span data-testid="skeleton-point" />,
  SkeletonRectangle: ({ className }: { className?: string }) => <div data-testid="skeleton-rectangle" className={className} />,
  SkeletonRow: ({ children }: { children: React.ReactNode }) => <div data-testid="skeleton-row">{children}</div>,
}))

vi.mock('./title', () => ({
  default: ({ title }: { title: string }) => <span data-testid="title">{title}</span>,
}))

vi.mock('../../../base/icons/src/vender/other', () => ({
  Group: ({ className }: { className: string }) => <span data-testid="group-icon" className={className} />,
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

describe('Placeholder', () => {
  let Placeholder: (typeof import('./placeholder'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./placeholder')
    Placeholder = mod.default
  })

  it('should render skeleton rows', () => {
    render(<Placeholder wrapClassName="w-full" />)

    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThanOrEqual(1)
  })

  it('should render group icon placeholder', () => {
    render(<Placeholder wrapClassName="w-full" />)

    expect(screen.getByTestId('group-icon')).toBeInTheDocument()
  })

  it('should render loading filename when provided', () => {
    render(<Placeholder wrapClassName="w-full" loadingFileName="test-plugin.zip" />)

    expect(screen.getByTestId('title')).toHaveTextContent('test-plugin.zip')
  })

  it('should render skeleton rectangles when no filename', () => {
    render(<Placeholder wrapClassName="w-full" />)

    expect(screen.getAllByTestId('skeleton-rectangle').length).toBeGreaterThanOrEqual(1)
  })
})

describe('LoadingPlaceholder', () => {
  let LoadingPlaceholder: (typeof import('./placeholder'))['LoadingPlaceholder']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./placeholder')
    LoadingPlaceholder = mod.LoadingPlaceholder
  })

  it('should render as a simple div with background', () => {
    const { container } = render(<LoadingPlaceholder />)

    // LoadingPlaceholder is a simple div, not using skeleton components
    expect(container.firstChild).toBeTruthy()
  })

  it('should accept className prop', () => {
    const { container } = render(<LoadingPlaceholder className="mt-3 w-[420px]" />)

    expect(container.firstChild).toBeTruthy()
  })
})
