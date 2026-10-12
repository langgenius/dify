import type { ReactNode } from 'react'
import type { DetailSidebarMode } from '../cookie'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import Cookies from 'js-cookie'
import { useState } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { DetailSidebarFrame } from '..'
import { DETAIL_SIDEBAR_COOKIE_NAME } from '../cookie'
import { detailSidebarModeAtom } from '../state'

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

function InitialDetailSidebarMode({
  children,
  mode,
}: {
  children: ReactNode
  mode: DetailSidebarMode
}) {
  useHydrateAtoms([[detailSidebarModeAtom, mode]])
  return children
}

function renderDetailSidebarFrame(
  currentEnv: string | null = null,
  platform: 'mac' | 'windows' = 'mac',
  compact = false,
  mode: DetailSidebarMode = 'expand',
) {
  return renderWithConsoleQuery(
    <Provider>
      <InitialDetailSidebarMode mode={mode}>
        <HotkeysProvider defaultOptions={{ hotkey: { platform } }}>
          <DetailSidebarFrame
            compact={compact}
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
        </HotkeysProvider>
      </InitialDetailSidebarMode>
    </Provider>,
    { accountProfileMeta: { currentEnv } },
  )
}

describe('DetailSidebarFrame', () => {
  beforeEach(() => {
    Cookies.remove(DETAIL_SIDEBAR_COOKIE_NAME)
  })

  it('renders expanded detail content by default', () => {
    renderDetailSidebarFrame()

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'true')
  })

  it('renders the server-provided collapsed preference on the first render', () => {
    renderDetailSidebarFrame(null, 'mac', false, 'collapse')

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'false')
  })

  it('starts compact navigation collapsed and toggles without changing the desktop preference', async () => {
    const user = userEvent.setup()
    renderDetailSidebarFrame(null, 'mac', true)

    expect(screen.getByRole('button', { name: 'account' })).toHaveTextContent('Compact account')
    await user.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(screen.getByRole('button', { name: 'account' })).toHaveTextContent('Expanded account')
    expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(screen.getByRole('button', { name: 'account' })).toHaveTextContent('Compact account')
    expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBeUndefined()
  })

  describe.each(['mac', 'windows'] as const)('%s shortcut', (platform) => {
    const modifiers = platform === 'mac' ? { metaKey: true } : { ctrlKey: true }

    it('toggles detail content once per press outside editing fields', () => {
      renderDetailSidebarFrame(null, platform)

      fireEvent.keyDown(document.body, { key: 'b', ...modifiers })

      expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'false')
      expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('collapse')

      expect(fireEvent.keyDown(document.body, { key: 'b', repeat: true, ...modifiers })).toBe(false)

      expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'false')

      fireEvent.keyUp(document.body, { key: 'b', ...modifiers })
      fireEvent.keyDown(document.body, { key: 'b', ...modifiers })

      expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
      expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('expand')
    })

    it('leaves a consumed shortcut to its local owner', () => {
      renderDetailSidebarFrame(null, platform)
      const button = screen.getByRole('button', { name: 'Toggle' })
      button.addEventListener('keydown', (event) => event.preventDefault(), { once: true })

      fireEvent.keyDown(button, { key: 'b', ...modifiers })

      expect(screen.getByRole('button', { name: 'account' })).toHaveTextContent('Expanded account')
      expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBeUndefined()
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
        expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBeUndefined()
      },
    )
  })

  it('collapses detail content from the top toggle and hides environment metadata', () => {
    renderDetailSidebarFrame('TESTING')
    fireEvent.click(screen.getByTestId('detail-toggle'))

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'false')
    expect(screen.queryByText('Environment tag')).not.toBeInTheDocument()
    expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('collapse')
  })

  it('shows a floating preview on collapsed hover without changing persisted state', () => {
    renderDetailSidebarFrame()
    fireEvent.click(screen.getByTestId('detail-toggle'))
    fireEvent.mouseEnter(screen.getByTestId('detail-top').parentElement!)

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'true')
    expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('collapse')
  })

  it('keeps collapsed bottom actions in place when they are hovered', () => {
    renderDetailSidebarFrame()
    fireEvent.click(screen.getByTestId('detail-toggle'))
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'help' }))

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByRole('button', { name: 'account' })).toHaveTextContent('Compact account')
    expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('collapse')
  })

  it('does not restore a stale hover preview after leaving compact layout', async () => {
    const user = userEvent.setup()

    function ResponsiveDetailSidebar() {
      const [compact, setCompact] = useState(false)
      return (
        <Provider>
          <InitialDetailSidebarMode mode="collapse">
            <HotkeysProvider>
              <button type="button" onClick={() => setCompact((value) => !value)}>
                Switch layout
              </button>
              <DetailSidebarFrame
                compact={compact}
                renderTop={({ expand }) => <div data-testid="detail-top" data-expand={expand} />}
                renderSection={() => <div>Section</div>}
              />
            </HotkeysProvider>
          </InitialDetailSidebarMode>
        </Provider>
      )
    }

    renderWithConsoleQuery(<ResponsiveDetailSidebar />, {
      accountProfileMeta: { currentEnv: null },
    })
    fireEvent.mouseEnter(screen.getByTestId('detail-top').parentElement!)
    expect(screen.getByRole('button', { name: 'account' })).toHaveTextContent('Expanded account')

    await user.click(screen.getByRole('button', { name: 'Switch layout' }))
    await user.click(screen.getByRole('button', { name: 'Switch layout' }))

    expect(screen.getByRole('button', { name: 'account' })).toHaveTextContent('Compact account')
  })

  it('persists expansion when the hovered preview toggle is clicked', () => {
    renderDetailSidebarFrame()
    fireEvent.click(screen.getByTestId('detail-toggle'))
    fireEvent.mouseEnter(screen.getByTestId('detail-top').parentElement!)
    fireEvent.click(screen.getByTestId('detail-toggle'))

    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'true')
    expect(Cookies.get(DETAIL_SIDEBAR_COOKIE_NAME)).toBe('expand')
  })
})
