import { act, waitFor, within } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { getPlatformFromUserAgent } from '../../shortcut-platform'
import { MainNavSearchButton } from '../search-button'

describe('MainNavSearchButton', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      initialLabel: '⌘K',
      initialShortcut: 'Meta+K',
      label: '⌘K',
      shortcut: 'Meta+K',
    },
    {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      initialLabel: 'CtrlK',
      initialShortcut: 'Control+K',
      label: 'CtrlK',
      shortcut: 'Control+K',
    },
    {
      platform: 'MacIntel',
      userAgent: null,
      initialLabel: '',
      initialShortcut: undefined,
      label: '⌘K',
      shortcut: 'Meta+K',
    },
    {
      platform: 'Win32',
      userAgent: null,
      initialLabel: '',
      initialShortcut: undefined,
      label: 'CtrlK',
      shortcut: 'Control+K',
    },
    {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      initialLabel: 'CtrlK',
      initialShortcut: 'Control+K',
      label: '⌘K',
      shortcut: 'Meta+K',
    },
  ])(
    'hydrates $userAgent on $platform without a mismatch',
    async ({ platform, userAgent, initialLabel, initialShortcut, label, shortcut }) => {
      vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform)
      const app = <MainNavSearchButton initialPlatform={getPlatformFromUserAgent(userAgent)} />
      const container = document.createElement('div')
      container.innerHTML = renderToString(app)
      const getSearchButton = () =>
        within(container).getByRole('button', { name: 'app.gotoAnything.searchTitle' })

      expect(getSearchButton().textContent).toBe(initialLabel)
      if (initialShortcut)
        expect(getSearchButton()).toHaveAttribute('aria-keyshortcuts', initialShortcut)
      else expect(getSearchButton()).not.toHaveAttribute('aria-keyshortcuts')
      expect(container.querySelector('kbd')).toHaveAttribute('aria-hidden', 'true')

      const onRecoverableError = vi.fn()
      const root = await act(async () =>
        hydrateRoot(container, app, {
          onRecoverableError,
        }),
      )

      try {
        await waitFor(() => expect(getSearchButton()).toHaveTextContent(label))
        expect(getSearchButton()).toHaveAttribute('aria-keyshortcuts', shortcut)
        expect(onRecoverableError).not.toHaveBeenCalled()
      } finally {
        act(() => root.unmount())
      }
    },
  )
})
