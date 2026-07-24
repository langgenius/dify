import { render, screen } from '@testing-library/react'
import HistoryPanel from './history-panel'

vi.mock('@/app/components/app/configuration/base/operation-btn', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button type="button" data-testid="edit-button" onClick={onClick}>
      edit
    </button>
  ),
}))

vi.mock('@/app/components/app/configuration/base/feature-panel', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('HistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render warning content when showWarning is true', () => {
    render(<HistoryPanel showWarning onShowEditModal={vi.fn()} />)

    expect(screen.getByText('appDebug.feature.conversationHistory.tip')).toBeInTheDocument()
  })

  it('should hide warning when showWarning is false', () => {
    render(<HistoryPanel showWarning={false} onShowEditModal={vi.fn()} />)

    expect(screen.queryByText('appDebug.feature.conversationHistory.tip')).toBeNull()
  })
})
