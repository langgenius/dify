import { render, screen } from '@testing-library/react'
import PublishMenu from '../publish-menu'

describe('PublishMenu', () => {
  it('should render the draft summary and publish shortcut', () => {
    const { container } = render(
      <PublishMenu
        draftUpdatedAt={0}
        publishedAt={0}
        uiMeta={{
          inputFieldCount: 1,
          checklistCount: 2,
          autoSavedAt: 'Auto-saved · a few seconds ago',
        }}
        onPublish={vi.fn()}
      />,
    )

    expect(screen.getByText('snippet.publishMenuCurrentDraft')).toBeInTheDocument()
    expect(screen.getByText('Auto-saved · a few seconds ago')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'snippet.publishButton' })).toBeInTheDocument()
    expect(container.querySelectorAll('.system-kbd')).toHaveLength(3)
  })

  it('should render published summary when a published version exists', () => {
    render(
      <PublishMenu
        draftUpdatedAt={1_712_300_000_000}
        publishedAt={1_712_345_678_000}
        uiMeta={{
          inputFieldCount: 1,
          checklistCount: 2,
          autoSavedAt: 'Auto-saved · a few seconds ago',
        }}
        onPublish={vi.fn()}
      />,
    )

    expect(screen.getByText('workflow.common.latestPublished')).toBeInTheDocument()
    expect(screen.getByText(/workflow\.common\.publishedAt/)).toBeInTheDocument()
  })
})
