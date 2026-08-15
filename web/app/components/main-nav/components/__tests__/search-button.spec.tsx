import { act, waitFor, within } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { MainNavSearchButton } from '../search-button'

describe('MainNavSearchButton', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders Ctrl during SSR and corrects it after Mac hydration without a mismatch', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const app = <MainNavSearchButton />
    const container = document.createElement('div')
    container.innerHTML = renderToString(app)
    const getSearchButton = () =>
      within(container).getByRole('button', { name: 'app.gotoAnything.searchTitle' })

    expect(getSearchButton()).toHaveTextContent('CtrlK')
    expect(getSearchButton()).not.toHaveTextContent('⌘')

    const onRecoverableError = vi.fn()
    const root = hydrateRoot(container, app, {
      onRecoverableError,
    })

    try {
      await waitFor(() => expect(getSearchButton()).toHaveTextContent('⌘K'))
      expect(onRecoverableError).not.toHaveBeenCalled()
    } finally {
      act(() => root.unmount())
    }
  })
})
