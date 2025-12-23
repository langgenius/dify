import React from 'react'
import { render, screen } from '@testing-library/react'
import HistoryPanel from './history-panel'

const mockDocLink = vi.fn(() => 'doc-link')
vi.mock('@/context/i18n', () => ({
  useDocLink: () => mockDocLink,
}))

vi.mock('@/app/components/app/configuration/base/operation-btn', () => ({
  __esModule: true,
  default: ({ onClick }: { onClick: () => void }) => (
    <button type="button" data-testid="edit-button" onClick={onClick}>
      edit
    </button>
  ),
}))

vi.mock('@/app/components/app/configuration/base/feature-panel', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('HistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render warning content and link when showWarning is true', () => {
    render(<HistoryPanel showWarning onShowEditModal={vi.fn()} />)

    expect(screen.getByText('appDebug.feature.conversationHistory.tip')).toBeInTheDocument()
    const link = screen.getByText('appDebug.feature.conversationHistory.learnMore')
    expect(link).toHaveAttribute('href', 'doc-link')
  })

  it('should hide warning when showWarning is false', () => {
    render(<HistoryPanel showWarning={false} onShowEditModal={vi.fn()} />)

    expect(screen.queryByText('appDebug.feature.conversationHistory.tip')).toBeNull()
  })
})
