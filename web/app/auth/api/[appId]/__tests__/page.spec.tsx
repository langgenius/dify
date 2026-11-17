import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import AppConnectionAuthPage from '../page'

describe('app connection authorization route', () => {
  it.each([
    { state: 'expired', title: 'share.connections.headless.expiredTitle' },
    {
      state: 'configuration-changed',
      title: 'share.connections.headless.configurationChangedTitle',
    },
  ])('renders the $state preview from the request URL', async ({ state, title }) => {
    const page = await AppConnectionAuthPage({
      params: Promise.resolve({ appId: 'sales-assistant' }),
      searchParams: Promise.resolve({ state }),
    })
    renderWithConsoleQuery(page, { accountProfile: null, currentWorkspace: null })

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([{ state: 'unrecognized' }, { state: ['expired', 'configuration-changed'] }])(
    'ignores unsupported or ambiguous preview values: $state',
    async ({ state }) => {
      const page = await AppConnectionAuthPage({
        params: Promise.resolve({ appId: 'sales-assistant' }),
        searchParams: Promise.resolve({ state }),
      })
      renderWithConsoleQuery(page, { accountProfile: null, currentWorkspace: null })

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'share.connections.headless.finishSetup' }),
      ).toBeDisabled()
    },
  )

  it('renders public connection setup for a Service API request', async () => {
    const page = await AppConnectionAuthPage({
      params: Promise.resolve({ appId: 'sales-assistant' }),
      searchParams: Promise.resolve({}),
    })
    renderWithConsoleQuery(page, { accountProfile: null, currentWorkspace: null })

    expect(screen.getByText(/share\.connections\.headless\.requestedFrom/)).toHaveTextContent(
      'Acme Assistant',
    )
    expect(screen.getByText(/share\.connections\.headless\.signedInAs/)).toHaveTextContent(
      'Feishu user •••1234',
    )
    expect(
      screen.getByRole('button', { name: 'share.connections.headless.finishSetup' }),
    ).toBeDisabled()
  })
})
