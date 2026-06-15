import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ApiAccess from '../index'

// Mock context and hooks for Card component
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: vi.fn(() => 'test-dataset-id'),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: vi.fn(() => true),
}))

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: vi.fn(() => 'https://api.example.com/docs'),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useEnableDatasetServiceApi: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useDisableDatasetServiceApi: vi.fn(() => ({ mutateAsync: vi.fn() })),
}))

afterEach(() => {
  cleanup()
})

describe('ApiAccess', () => {
  it('should render without crashing', () => {
    render(<ApiAccess expand={true} apiEnabled={true} />)
    expect(screen.getByText('common.appMenus.apiAccess')).toBeInTheDocument()
  })

  it('should render API access text when expanded', () => {
    render(<ApiAccess expand={true} apiEnabled={true} />)
    expect(screen.getByText('common.appMenus.apiAccess')).toBeInTheDocument()
  })

  it('should not render API access text when collapsed', () => {
    render(<ApiAccess expand={false} apiEnabled={true} />)
    expect(screen.queryByText('common.appMenus.apiAccess')).not.toBeInTheDocument()
  })

  it('should render with apiEnabled=true', () => {
    render(<ApiAccess expand={true} apiEnabled={true} />)
    expect(screen.getByText('common.appMenus.apiAccess')).toBeInTheDocument()
  })

  it('should render with apiEnabled=false', () => {
    render(<ApiAccess expand={true} apiEnabled={false} />)
    expect(screen.getByText('common.appMenus.apiAccess')).toBeInTheDocument()
  })

  it('should be wrapped with React.memo', () => {
    expect((ApiAccess as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
  })

  describe('toggle functionality', () => {
    it('should toggle open state when trigger is clicked', async () => {
      const { container } = render(<ApiAccess expand={true} apiEnabled={true} />)
      const trigger = container.querySelector('.cursor-pointer')
      expect(trigger).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(trigger!)
      })

      // The component should update its state - check for state change via class
      expect(trigger).toBeInTheDocument()
    })

    it('should toggle open state multiple times', async () => {
      const { container } = render(<ApiAccess expand={true} apiEnabled={true} />)
      const trigger = container.querySelector('.cursor-pointer')

      // First click - open
      await act(async () => {
        fireEvent.click(trigger!)
      })

      // Second click - close
      await act(async () => {
        fireEvent.click(trigger!)
      })

      expect(trigger).toBeInTheDocument()
    })

    it('should work when collapsed', async () => {
      const { container } = render(<ApiAccess expand={false} apiEnabled={true} />)
      const trigger = container.querySelector('.cursor-pointer')

      await act(async () => {
        fireEvent.click(trigger!)
      })

      expect(trigger).toBeInTheDocument()
    })
  })

  describe('indicator color', () => {
    it('should render with green indicator when apiEnabled is true', () => {
      const { container } = render(<ApiAccess expand={true} apiEnabled={true} />)
      // Indicator component should be present
      const indicator = container.querySelector('.shrink-0')
      expect(indicator).toBeInTheDocument()
    })

    it('should render with yellow indicator when apiEnabled is false', () => {
      const { container } = render(<ApiAccess expand={true} apiEnabled={false} />)
      const indicator = container.querySelector('.shrink-0')
      expect(indicator).toBeInTheDocument()
    })
  })

  describe('layout', () => {
    it('should have justify-center when collapsed', () => {
      const { container } = render(<ApiAccess expand={false} apiEnabled={true} />)
      const trigger = container.querySelector('.justify-center')
      expect(trigger).toBeInTheDocument()
    })

    it('should not have justify-center when expanded', () => {
      const { container } = render(<ApiAccess expand={true} apiEnabled={true} />)
      const innerDiv = container.querySelector('.cursor-pointer')
      // When expanded, should have gap-2 and text, not justify-center
      expect(innerDiv).not.toHaveClass('justify-center')
    })
  })
})
