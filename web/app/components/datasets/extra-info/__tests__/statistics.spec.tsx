import type { RelatedApp, RelatedAppResponse } from '@/models/datasets'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppModeEnum } from '@/types/app'
import Statistics from '../statistics'

// Mock useDocLink
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

afterEach(() => {
  cleanup()
})

describe('Statistics', () => {
  const mockRelatedApp: RelatedApp = {
    id: 'app-1',
    name: 'Test App',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#ffffff',
    icon_url: '',
  }

  const mockRelatedApps: RelatedAppResponse = {
    data: [mockRelatedApp],
    total: 1,
  }

  it('should render document count', () => {
    render(<Statistics expand={true} documentCount={5} relatedApps={mockRelatedApps} />)
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('should render document label', () => {
    render(<Statistics expand={true} documentCount={5} relatedApps={mockRelatedApps} />)
    expect(screen.getByText('common.datasetMenus.documents')).toBeInTheDocument()
  })

  it('should render related apps total', () => {
    render(<Statistics expand={true} documentCount={5} relatedApps={mockRelatedApps} />)
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('should render related app label', () => {
    render(<Statistics expand={true} documentCount={5} relatedApps={mockRelatedApps} />)
    expect(screen.getByText('common.datasetMenus.relatedApp')).toBeInTheDocument()
  })

  it('should render -- for undefined document count', () => {
    render(<Statistics expand={true} relatedApps={mockRelatedApps} />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('should render -- for undefined related apps total', () => {
    render(<Statistics expand={true} documentCount={5} />)
    const dashes = screen.getAllByText('--')
    expect(dashes.length).toBeGreaterThan(0)
  })

  it('should render with zero document count', () => {
    render(<Statistics expand={true} documentCount={0} relatedApps={mockRelatedApps} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('should render with empty related apps', () => {
    const emptyRelatedApps: RelatedAppResponse = {
      data: [],
      total: 0,
    }
    render(<Statistics expand={true} documentCount={5} relatedApps={emptyRelatedApps} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('should be wrapped with React.memo', () => {
    expect((Statistics as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
  })
})
