import { fireEvent, render, screen } from '@testing-library/react'
import { DetailSidebarFrame } from '..'
import { DETAIL_SIDEBAR_STORAGE_KEY } from '../storage'

const { hotkeyRegistrations } = vi.hoisted(() => ({
  hotkeyRegistrations: new Map<string, {
    handler: (event: { preventDefault: () => void }) => void
    options?: { ignoreInputs?: boolean }
  }>(),
}))
const mockAppContextState = vi.hoisted(() => ({
  current: {
    langGeniusVersionInfo: {
      current_env: '',
    },
  },
}))

vi.mock('@tanstack/react-hotkeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-hotkeys')>()
  return {
    ...actual,
    useHotkey: (
      hotkey: string,
      handler: (event: { preventDefault: () => void }) => void,
      options?: { ignoreInputs?: boolean },
    ) => {
      hotkeyRegistrations.set(hotkey, { handler, options })
    },
  }
})

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/app/components/main-nav/components/account-section', () => ({
  default: ({ compact }: { compact?: boolean }) => (
    <button type="button" aria-label="account">{compact ? 'Compact account' : 'Expanded account'}</button>
  ),
}))

vi.mock('@/app/components/main-nav/components/help-menu', () => ({
  default: ({ triggerClassName }: { triggerClassName?: string }) => (
    <button type="button" aria-label="help" className={triggerClassName}>Help</button>
  ),
}))

vi.mock('@/app/components/header/env-nav', () => ({
  default: () => <div>Environment tag</div>,
}))

function renderDetailSidebarFrame() {
  return render(
    <DetailSidebarFrame
      renderTop={({ expand, onToggle }) => (
        <div data-testid="detail-top" data-expand={expand}>
          <button type="button" data-testid="detail-toggle" onClick={onToggle}>Toggle</button>
        </div>
      )}
      renderSection={({ expand }) => (
        <div data-testid="detail-section" data-expand={expand}>Section</div>
      )}
    />,
  )
}

describe('DetailSidebarFrame', () => {
  beforeEach(() => {
    localStorage.clear()
    hotkeyRegistrations.clear()
    mockAppContextState.current = {
      langGeniusVersionInfo: {
        current_env: '',
      },
    }
  })

  it('renders expanded detail content by default and registers the shortcut for focused inputs', () => {
    renderDetailSidebarFrame()

    expect(screen.getByRole('complementary')).toHaveClass('w-62')
    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'true')
    expect(hotkeyRegistrations.get('Mod+B')?.options).toEqual(
      expect.objectContaining({ ignoreInputs: false }),
    )
  })

  it('collapses detail content from the top toggle and hides environment metadata', () => {
    mockAppContextState.current = {
      langGeniusVersionInfo: {
        current_env: 'TESTING',
      },
    }

    renderDetailSidebarFrame()
    fireEvent.click(screen.getByTestId('detail-toggle'))

    expect(screen.getByRole('complementary')).toHaveClass('w-16')
    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'false')
    expect(screen.queryByText('Environment tag')).not.toBeInTheDocument()
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
  })

  it('shows a floating preview on collapsed hover without changing persisted state', () => {
    renderDetailSidebarFrame()
    fireEvent.click(screen.getByTestId('detail-toggle'))
    fireEvent.mouseEnter(screen.getByTestId('detail-top').parentElement!)

    expect(screen.getByRole('complementary')).toHaveClass('w-16', 'overflow-visible')
    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'true')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('collapse')
  })

  it('persists expansion without width animation when the hovered preview toggle is clicked', () => {
    renderDetailSidebarFrame()
    fireEvent.click(screen.getByTestId('detail-toggle'))
    fireEvent.mouseEnter(screen.getByTestId('detail-top').parentElement!)
    fireEvent.click(screen.getByTestId('detail-toggle'))

    expect(screen.getByRole('complementary')).toHaveClass('w-62', 'transition-none')
    expect(screen.getByRole('complementary')).not.toHaveClass('overflow-visible')
    expect(screen.getByTestId('detail-top')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('detail-section')).toHaveAttribute('data-expand', 'true')
    expect(localStorage.getItem(DETAIL_SIDEBAR_STORAGE_KEY)).toBe('expand')
  })
})
