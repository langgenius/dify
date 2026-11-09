import type { ReactElement } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import ConnectionAuth from '..'

const connectLabel = 'share.connections.setup.connect'
const finishLabel = 'share.connections.headless.finishSetup'
const addKeyLabel = 'share.connections.setup.addApiKey'
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, { accountProfile: null, currentWorkspace: null })

const serviceRow = (name: string) => screen.getByRole('listitem', { name })
const progress = () => screen.getByText(/share\.connections\.headless\.apiProgress/)
const readyMessage = () => screen.getByText(/share\.connections\.headless\.allConnected/)

async function connectServices(user: ReturnType<typeof userEvent.setup>) {
  for (const provider of ['Gmail', 'Notion', 'Google Search'])
    await user.click(within(serviceRow(provider)).getByRole('button', { name: connectLabel }))
}

describe('ConnectionAuth', () => {
  it.each([
    {
      linkState: 'expired' as const,
      title: 'share.connections.headless.expiredTitle',
      description: /share\.connections\.headless\.apiExpiredDescription/,
    },
    {
      linkState: 'configuration-changed' as const,
      title: 'share.connections.headless.configurationChangedTitle',
      description: /share\.connections\.headless\.apiConfigurationChangedDescription/,
    },
  ])(
    'stops setup and identifies the Service API requester for $linkState',
    ({ linkState, title, description }) => {
      render(<ConnectionAuth appId="sales-assistant" linkState={linkState} />)

      const issue = screen.getByRole('alert')
      expect(within(issue).getByRole('heading', { name: title })).toBeInTheDocument()
      expect(within(issue).getByText(description)).toHaveTextContent('Acme Assistant')
      expect(screen.getByRole('heading', { name: 'Sales Follow-up Assistant' })).toBeInTheDocument()
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(
        screen.queryByText(/share\.connections\.headless\.requestedFrom/),
      ).not.toBeInTheDocument()
      expect(screen.queryByText(/share\.connections\.headless\.signedInAs/)).not.toBeInTheDocument()
    },
  )

  it('starts a fresh setup after an invalidated request replaces an in-progress session', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ConnectionAuth appId="sales-assistant" />)
    await user.click(within(serviceRow('Gmail')).getByRole('button', { name: connectLabel }))
    expect(progress()).toHaveTextContent('"connected":1')

    rerender(<ConnectionAuth appId="sales-assistant" linkState="expired" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(<ConnectionAuth appId="sales-assistant" linkState="setup" />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(progress()).toHaveTextContent('"connected":0')
    expect(within(serviceRow('Gmail')).getByRole('button', { name: connectLabel })).toBeEnabled()
    expect(screen.getByRole('button', { name: finishLabel })).toBeDisabled()
  })

  it('offers public connection setup without a sign-in step and requires every service', () => {
    render(<ConnectionAuth appId="sales-assistant" />)

    expect(screen.getByRole('heading', { name: 'Sales Follow-up Assistant' })).toBeInTheDocument()
    expect(screen.getByText(/share\.connections\.headless\.requestedFrom/)).toHaveTextContent(
      'Acme Assistant',
    )
    expect(progress()).toHaveTextContent('"connected":0')
    expect(progress()).toHaveTextContent('"total":3')
    expect(screen.getByRole('button', { name: finishLabel })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: connectLabel })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /sign.?in/i })).not.toBeInTheDocument()
  })

  it('automatically selects new accounts and finishes only after all services are connected', async () => {
    const user = userEvent.setup()
    render(<ConnectionAuth appId="sales-assistant" />)

    await user.click(within(serviceRow('Gmail')).getByRole('button', { name: connectLabel }))
    expect(within(serviceRow('Gmail')).getByRole('button', { name: 'Gmail' })).toHaveTextContent(
      'alex@northstar.io',
    )
    expect(progress()).toHaveTextContent('"connected":1')
    expect(screen.getByRole('button', { name: finishLabel })).toBeDisabled()

    for (const provider of ['Notion', 'Google Search'])
      await user.click(within(serviceRow(provider)).getByRole('button', { name: connectLabel }))
    expect(readyMessage()).toHaveTextContent('"count":3')
    await user.click(screen.getByRole('button', { name: finishLabel }))

    expect(
      screen.getByRole('heading', { name: 'share.connections.headless.completeTitle' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/share\.connections\.headless\.continuesAutomatically/),
    ).toHaveTextContent('Acme Assistant')
    for (const provider of ['Gmail', 'Notion', 'Google Search'])
      expect(within(serviceRow(provider)).getByText('alex@northstar.io')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/share\.connections\.headless\.requestedFrom/),
    ).not.toBeInTheDocument()
    expect(screen.getByText('share.connections.headless.closeWindow')).toBeInTheDocument()
  })

  it('keeps an invalid API key in the editor and selects the corrected key after saving', async () => {
    const user = userEvent.setup()
    render(<ConnectionAuth appId="sales-assistant" />)
    await user.click(within(serviceRow('Google Search')).getByRole('button', { name: addKeyLabel }))

    const dialog = screen.getByRole('dialog', { name: addKeyLabel })
    const key = within(dialog).getByLabelText(/API Key/)
    const name = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    const save = within(dialog).getByRole('button', { name: 'common.operation.save' })
    expect(key).toHaveValue('')
    expect(save).toBeDisabled()
    await user.type(name, 'Research key')
    await user.type(key, 'invalid-key')
    await user.click(save)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'share.connections.apiKeys.validationError',
    )
    expect(save).toBeDisabled()
    expect(key).toHaveValue('invalid-key')
    expect(progress()).toHaveTextContent('"connected":0')

    await user.clear(key)
    await user.type(key, 'sk-research')
    await user.click(save)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    expect(
      within(serviceRow('Google Search')).getByRole('button', { name: 'Google Search' }),
    ).toHaveTextContent('Research key')
    expect(progress()).toHaveTextContent('"connected":1')

    for (const provider of ['Gmail', 'Notion'])
      await user.click(within(serviceRow(provider)).getByRole('button', { name: connectLabel }))
    await user.click(screen.getByRole('button', { name: finishLabel }))
    expect(within(serviceRow('Google Search')).getByText('Research key')).toBeInTheDocument()
    expect(screen.queryByText('sk-research')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('disables finishing again when the selected account is removed', async () => {
    const user = userEvent.setup()
    render(<ConnectionAuth appId="sales-assistant" />)
    await connectServices(user)
    expect(screen.getByRole('button', { name: finishLabel })).toBeEnabled()
    expect(readyMessage()).toHaveTextContent('"count":3')

    await user.click(within(serviceRow('Gmail')).getByRole('button', { name: 'Gmail' }))
    const selector = screen.getByRole('dialog', {
      name: 'share.connections.accounts.title:{"provider":"Gmail"}',
    })
    await user.click(
      within(selector).getByRole('button', { name: /share\.connections\.accounts\.moreActions/ }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'share.connections.accounts.remove' }),
    )
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'app.endUser.disconnectConnectionTitle',
    })
    await user.click(within(confirmation).getByRole('button', { name: 'app.endUser.disconnect' }))
    await waitFor(() => expect(confirmation).not.toBeInTheDocument())

    expect(progress()).toHaveTextContent('"connected":2')
    expect(screen.queryByText(/share\.connections\.headless\.allConnected/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: finishLabel })).toBeDisabled()
    expect(within(serviceRow('Gmail')).getByRole('button', { name: connectLabel })).toBeEnabled()
  })

  it('selects an added account and lets the user switch back to an existing account', async () => {
    const user = userEvent.setup()
    render(<ConnectionAuth appId="sales-assistant" />)
    await user.click(within(serviceRow('Gmail')).getByRole('button', { name: connectLabel }))
    await user.click(within(serviceRow('Gmail')).getByRole('button', { name: 'Gmail' }))
    const selectorName = 'share.connections.accounts.title:{"provider":"Gmail"}'
    await user.click(
      within(screen.getByRole('dialog', { name: selectorName })).getByRole('button', {
        name: 'share.connections.accounts.addAccount',
      }),
    )
    expect(within(serviceRow('Gmail')).getByRole('button', { name: 'Gmail' })).toHaveTextContent(
      'alex+2@northstar.io',
    )

    await user.click(within(serviceRow('Gmail')).getByRole('button', { name: 'Gmail' }))
    await user.click(
      within(screen.getByRole('dialog', { name: selectorName })).getByRole('button', {
        name: 'alex@northstar.io',
      }),
    )

    expect(within(serviceRow('Gmail')).getByRole('button', { name: 'Gmail' })).toHaveTextContent(
      'alex@northstar.io',
    )
    expect(progress()).toHaveTextContent('"connected":1')
  })

  it('replaces an API key without creating another connection or prefilling its secret', async () => {
    const user = userEvent.setup()
    render(<ConnectionAuth appId="sales-assistant" />)
    await user.click(within(serviceRow('Google Search')).getByRole('button', { name: addKeyLabel }))
    const addDialog = screen.getByRole('dialog', { name: addKeyLabel })
    await user.type(
      within(addDialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Original key',
    )
    await user.type(within(addDialog).getByLabelText(/API Key/), 'sk-original')
    await user.click(within(addDialog).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(addDialog).not.toBeInTheDocument())

    await user.click(
      within(serviceRow('Google Search')).getByRole('button', { name: 'Google Search' }),
    )
    const selectorName = 'share.connections.apiKeys.title:{"provider":"Google Search"}'
    const selector = screen.getByRole('dialog', { name: selectorName })
    await user.click(
      within(selector).getByRole('button', { name: /share\.connections\.accounts\.moreActions/ }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'share.connections.apiKeys.replaceTitle' }),
    )
    const replaceDialog = await screen.findByRole('dialog', {
      name: 'share.connections.apiKeys.replaceTitle',
    })
    const name = within(replaceDialog).getByRole('textbox', {
      name: 'plugin.auth.authorizationName',
    })
    const token = within(replaceDialog).getByLabelText(/API Key/)
    expect(name).toHaveValue('Original key')
    expect(token).toHaveValue('')
    await user.clear(name)
    await user.type(name, 'Replacement key')
    await user.type(token, 'sk-replacement')
    await user.click(within(replaceDialog).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(replaceDialog).not.toBeInTheDocument())

    const selected = within(serviceRow('Google Search')).getByRole('button', {
      name: 'Google Search',
    })
    expect(selected).toHaveTextContent('Replacement key')
    expect(progress()).toHaveTextContent('"connected":1')
    await user.click(selected)
    expect(
      within(screen.getByRole('dialog', { name: selectorName })).getAllByRole('listitem'),
    ).toHaveLength(1)
  })

  it('resets the mock session when the application changes and identifies Service API requests', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ConnectionAuth appId="first-app" />)
    await user.click(within(serviceRow('Gmail')).getByRole('button', { name: connectLabel }))
    expect(progress()).toHaveTextContent('"connected":1')
    expect(screen.getByText(/share\.connections\.headless\.requestedFrom/)).toHaveTextContent(
      'Acme Assistant',
    )
    expect(screen.getByText(/share\.connections\.headless\.signedInAs/)).toHaveTextContent(
      'Feishu user •••1234',
    )
    expect(screen.getByText(/share\.connections\.headless\.apiProgress/)).toHaveTextContent(
      'Acme Assistant',
    )
    expect(screen.getByText(/share\.connections\.headless\.security/)).toHaveTextContent(
      'Acme Assistant',
    )

    rerender(<ConnectionAuth appId="second-app" />)

    expect(progress()).toHaveTextContent('"connected":0')
    expect(within(serviceRow('Gmail')).getByRole('button', { name: connectLabel })).toBeEnabled()
    expect(screen.getByRole('button', { name: finishLabel })).toBeDisabled()

    await connectServices(user)
    await user.click(screen.getByRole('button', { name: finishLabel }))
    expect(
      screen.getByText(/share\.connections\.headless\.continuesAutomatically/),
    ).toHaveTextContent('Acme Assistant')
    expect(screen.getByText('share.connections.headless.closeWindow')).toBeInTheDocument()
  })
})
