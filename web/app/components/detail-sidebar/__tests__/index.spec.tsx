import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { DetailSidebarFrame } from '..'
import { DETAIL_SIDEBAR_STORAGE_KEY } from '../storage'

vi.mock('@/app/components/main-nav/components/account-section', () => ({
  default: ({ compact }: { compact?: boolean }) => (
    <button type="button" aria-label="account">
      {compact ? 'Compact account' : 'Expanded account'}
    </button>
  ),
}))

vi.mock('@/app/components/main-nav/components/help-menu', () => ({
  default: ({ triggerClassName }: { triggerClassName?: string }) => (
    <button type="button" aria-label="help" className={triggerClassName}>
      Help
    </button>
  ),
}))

vi.mock('@/app/components/header/env-nav', () => ({
  default: () => <div>Environment tag</div>,
}))

function renderDetailSidebarFrame(
  currentEnv: string | null = null,
  platform: 'mac' | 'windows' = 'mac',
) {
  return renderWithConsoleQuery(
    <HotkeysProvider defaultOptions={{ hotkey: { platform } }}>
      <DetailSidebarFrame
        renderTop={({ expand, onToggle }) => (
          <div data-testid="detail-top" data-expand={expand}>
            <button type="button" data-testid="detail-toggle" onClick={onToggle}>
              Toggle
            </button>
          </div>
        )}
        renderSection={({ expand }) => (
          <div data-testid="detail-section" data-expand={expand}>
            Section
          </div>
        )}
      />
      <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Note">
        <span>Note text</span>
      </div>
      <input aria-label="Name" />
      <textarea aria-label="Description" />
    </HotkeysProvider>,
    { accountProfileMeta: { currentEnv } },
  )
}

describe('DetailSidebarFrame', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders expanded detail content by default', () => {
    renderDetailSidebarFrame()

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'true')
  })

  describe.each(['mac', 'windows'] as const)('%s shortcut', (platform) => {
    const modifiers = platform === 'mac' ? { metaKey: true } : { ctrlKey: true }

    it('toggles detail content outside editing fields', () => {
      renderDetailSidebarFrame(null, platform)

      fireEvent.keyDown(document.body, { key: 'b', ...modifiers })

      expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'false')
      expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')

      fireEvent.keyDown(document.body, { key: 'b', ...modifiers })

      expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
      expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('expand')
    })

    it.each(['Note', 'Note text', 'Name', 'Description'])(
      'leaves the shortcut to the %s editor',
      (name) => {
        renderDetailSidebarFrame(null, platform)
        const editor =
          name === 'Note text' ? screen.getByText(name) : screen.getByRole('textbox', { name })
        editor.focus()
        const event = new KeyboardEvent('keydown', {
          key: 'b',
          ...modifiers,
          bubbles: true,
          cancelable: true,
        })

        fireEvent(editor, event)

        expect(event.defaultPrevented).toBe(false)
        expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
        expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('expand')
      },
    )
  })

  it('collapses detail content from the top toggle and hides environment metadata', () => {
    renderDetailSidebarFrame('TESTING')
    fireEvent.click(screen.getByTestId('detail-toggle'))

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'false')
    expect(screen.queryByText('Environment tag')).not.toBeInTheDocument()
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
  })

  it('shows a floating preview on collapsed hover without changing persisted state', () => {
    renderDetailSidebarFrame()
    fireEvent.click(screen.getByTestId('detail-toggle'))
    fireEvent.mouseEnter(screen.getByTestId('detail-top').parentElement!)

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'true')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
  })

  it('keeps collapsed bottom actions in place when they are hovered', () => {
    renderDetailSidebarFrame()
    fireEvent.click(screen.getByTestId('detail-toggle'))
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'help' }))

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByRole('button', { name: 'account' })).toHaveTextContent('Compact account')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
  })

  it('persists expansion when the hovered preview toggle is clicked', () => {
    renderDetailSidebarFrame()
    fireEvent.click(screen.getByTestId('detail-toggle'))
    fireEvent.mouseEnter(screen.getByTestId('detail-top').parentElement!)
    fireEvent.click(screen.getByTestId('detail-toggle'))

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'true')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('expand')
  })
})
