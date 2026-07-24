import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NoLinkedAppsPanel from '../no-linked-apps-panel'

// Mock useDocLink
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

afterEach(() => {
  cleanup()
})

describe('NoLinkedAppsPanel', () => {
  it('should render without crashing', () => {
    render(<NoLinkedAppsPanel />)
    expect(screen.getByText('common.datasetMenus.emptyTip')).toBeInTheDocument()
  })

  it('should render the empty tip text', () => {
    render(<NoLinkedAppsPanel />)
    expect(screen.getByText('common.datasetMenus.emptyTip')).toBeInTheDocument()
  })

  it('should render the view doc link', () => {
    render(<NoLinkedAppsPanel />)
    expect(screen.getByText('common.datasetMenus.viewDoc')).toBeInTheDocument()
  })

  it('should render link with correct href', () => {
    render(<NoLinkedAppsPanel />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://docs.example.com/use-dify/knowledge/integrate-knowledge-within-application')
  })

  it('should render link with target="_blank"', () => {
    render(<NoLinkedAppsPanel />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('should render link with rel="noopener noreferrer"', () => {
    render(<NoLinkedAppsPanel />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('should be wrapped with React.memo', () => {
    expect((NoLinkedAppsPanel as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
  })
})
