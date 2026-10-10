import type { AppUserAuthDraft } from '../draft'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import AppUserAuth from '..'
import { createAppUserAuthDraft } from '../draft'

const clientDialogName = 'plugin.auth.oauthClientSettings'
const clientIdLabel = 'plugin.auth.appUser.clientId'
const clientSecretLabel = 'plugin.auth.appUser.clientSecret'
const saveLabel = 'plugin.auth.saveOnly'

const ControlledHarness = ({
  initialDraft,
  onChange,
}: {
  initialDraft: AppUserAuthDraft
  onChange: (draft: AppUserAuthDraft) => void
}) => {
  const [draft, setDraft] = useState(initialDraft)

  return (
    <AppUserAuth
      value={draft}
      onChange={(nextDraft) => {
        setDraft(nextDraft)
        onChange(nextDraft)
      }}
    />
  )
}

const saveCustomClient = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.configureClient' }))
  const dialog = await screen.findByRole('dialog', { name: clientDialogName })
  await user.type(within(dialog).getByRole('textbox', { name: clientIdLabel }), 'client-id')
  await user.type(
    within(dialog).getByLabelText(clientSecretLabel, { exact: false }),
    'client-secret',
  )
  await user.click(within(dialog).getByRole('button', { name: saveLabel }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
}

describe('AppUserAuth', () => {
  it('enables both available methods by default and toggles the API key explanation', async () => {
    const user = userEvent.setup()
    render(<AppUserAuth />)

    expect(screen.getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' })).toBeChecked()
    const apiKey = screen.getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' })
    expect(apiKey).toBeChecked()
    expect(screen.getByText('plugin.auth.appUser.apiKeyDescription')).toBeVisible()

    await user.click(apiKey)

    expect(apiKey).not.toBeChecked()
    expect(screen.queryByText('plugin.auth.appUser.apiKeyDescription')).not.toBeInTheDocument()

    await user.click(apiKey)

    expect(screen.getByText('plugin.auth.appUser.apiKeyDescription')).toBeVisible()
  })

  it.each([
    { canOAuth: false, canApiKey: true },
    { canOAuth: true, canApiKey: false },
    { canOAuth: false, canApiKey: false },
  ])('offers only supported methods for $canOAuth OAuth and $canApiKey API key', (props) => {
    render(<AppUserAuth {...props} />)

    for (const { available, name } of [
      { available: props.canOAuth, name: 'plugin.auth.appUser.oauth' },
      { available: props.canApiKey, name: 'plugin.auth.connection.apiKey' },
    ]) {
      const method = screen.queryByRole('checkbox', { name })
      if (available) expect(method).toBeChecked()
      else expect(method).not.toBeInTheDocument()
    }
    expect(
      screen.getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }),
    ).toBeVisible()
  })

  it('saves a custom client locally and retains it while OAuth is disabled', async () => {
    const user = userEvent.setup()
    render(<AppUserAuth providerName="Google Drive" />)
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.configureClient' }))
    const dialog = await screen.findByRole('dialog', { name: clientDialogName })
    const unavailableDefault = within(dialog).getByRole('radio', { name: 'plugin.auth.default' })
    expect(unavailableDefault).toHaveAttribute('aria-disabled', 'true')
    expect(within(dialog).getByRole('radio', { name: 'plugin.auth.custom' })).toBeChecked()
    await user.click(unavailableDefault)
    expect(within(dialog).getByRole('radio', { name: 'plugin.auth.custom' })).toBeChecked()

    await user.type(within(dialog).getByRole('textbox', { name: clientIdLabel }), '  client-id  ')
    await user.type(
      within(dialog).getByLabelText(clientSecretLabel, { exact: false }),
      'client-secret',
    )
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' })).toBeVisible()
    expect(
      screen.getByText(
        'plugin.auth.appUser.oauthDescriptionWithProvider:{"provider":"Google Drive"}',
      ),
    ).toBeVisible()
    expect(document.body).not.toHaveTextContent('client-secret')
    const oauth = screen.getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' })
    await user.click(oauth)
    expect(
      screen.queryByRole('button', { name: 'plugin.auth.appUser.customClient' }),
    ).not.toBeInTheDocument()

    await user.click(oauth)
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }))

    const reopened = await screen.findByRole('dialog', { name: clientDialogName })
    expect(within(reopened).getByRole('textbox', { name: clientIdLabel })).toHaveValue('client-id')
    expect(within(reopened).getByLabelText(clientSecretLabel, { exact: false })).toHaveValue(
      'client-secret',
    )
  })

  it.each(['cancel', 'escape'] as const)(
    'discards client edits when closed with %s',
    async (close) => {
      const user = userEvent.setup()
      render(<AppUserAuth />)
      await saveCustomClient(user)
      await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }))
      const dialog = await screen.findByRole('dialog', { name: clientDialogName })
      const clientId = within(dialog).getByRole('textbox', { name: clientIdLabel })
      const clientSecret = within(dialog).getByLabelText(clientSecretLabel, { exact: false })
      await user.clear(clientId)
      await user.type(clientId, 'unsaved-client')
      await user.clear(clientSecret)
      await user.type(clientSecret, 'unsaved-secret')

      if (close === 'cancel') {
        await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
      } else {
        await user.keyboard('{Escape}')
      }
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }))

      const reopened = await screen.findByRole('dialog', { name: clientDialogName })
      expect(within(reopened).getByRole('textbox', { name: clientIdLabel })).toHaveValue(
        'client-id',
      )
      expect(within(reopened).getByLabelText(clientSecretLabel, { exact: false })).toHaveValue(
        'client-secret',
      )
    },
  )

  it('allows an available default client to replace custom client configuration', async () => {
    const user = userEvent.setup()
    render(<AppUserAuth defaultClientAvailable />)
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.defaultClient' }))
    let dialog = await screen.findByRole('dialog', { name: clientDialogName })
    expect(within(dialog).getByRole('radio', { name: 'plugin.auth.default' })).toBeChecked()
    expect(within(dialog).queryByRole('textbox', { name: clientIdLabel })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'plugin.auth.custom' }))
    await user.type(within(dialog).getByRole('textbox', { name: clientIdLabel }), 'client-id')
    await user.type(
      within(dialog).getByLabelText(clientSecretLabel, { exact: false }),
      'client-secret',
    )
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }))
    dialog = await screen.findByRole('dialog', { name: clientDialogName })
    await user.click(within(dialog).getByRole('radio', { name: 'plugin.auth.default' }))
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'plugin.auth.appUser.defaultClient' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.defaultClient' }))
    const reopened = await screen.findByRole('dialog', { name: clientDialogName })
    expect(within(reopened).getByRole('radio', { name: 'plugin.auth.default' })).toBeChecked()
    expect(within(reopened).queryByRole('textbox', { name: clientIdLabel })).not.toBeInTheDocument()
  })

  it('requires both custom client fields on save without showing errors while initially editing', async () => {
    const user = userEvent.setup()
    render(<AppUserAuth />)
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.configureClient' }))
    const dialog = await screen.findByRole('dialog', { name: clientDialogName })
    const clientId = within(dialog).getByRole('textbox', { name: clientIdLabel })
    const clientSecret = within(dialog).getByLabelText(clientSecretLabel, { exact: false })
    expect(clientId).toBeRequired()
    expect(clientSecret).toBeRequired()
    expect(clientSecret).toHaveAccessibleName(clientSecretLabel)
    await user.type(clientId, 'draft')
    await user.clear(clientId)
    expect(clientId).not.toHaveAttribute('aria-invalid', 'true')
    expect(clientSecret).not.toHaveAttribute('aria-invalid', 'true')

    await user.click(within(dialog).getByRole('button', { name: saveLabel }))

    expect(clientId).toHaveAttribute('aria-invalid', 'true')
    expect(clientSecret).toHaveAttribute('aria-invalid', 'true')
    expect(dialog).toBeVisible()
    await user.type(clientId, 'client-id')
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    expect(clientId).not.toHaveAttribute('aria-invalid', 'true')
    expect(clientSecret).toHaveAttribute('aria-invalid', 'true')
    await user.type(clientSecret, 'client-secret')
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' })).toBeVisible()
  })

  it('limits typed and pasted descriptions to 50 characters and updates the count and validity', async () => {
    const user = userEvent.setup()
    render(<AppUserAuth />)
    const description = screen.getByRole('textbox', {
      name: 'plugin.auth.appUser.connectionDescription',
    })
    expect(description).toBeRequired()
    expect(description).toHaveAccessibleDescription(/0\/50/)
    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    await user.type(description, 'Drive')
    expect(description).toHaveAccessibleDescription('5/50')
    await user.clear(description)
    expect(description).toHaveAttribute('aria-invalid', 'true')

    await user.type(description, 'T'.repeat(55))
    expect(description).toHaveValue('T'.repeat(50))
    expect(description).toHaveAccessibleDescription('50/50')
    await user.clear(description)
    await user.paste('P'.repeat(55))

    expect(description).toHaveValue('P'.repeat(50))
    expect(description).toHaveAccessibleDescription('50/50')
    expect(description).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('revalidates method choices immediately and accepts API key without a client', async () => {
    const user = userEvent.setup()
    const initialDraft = { ...createAppUserAuthDraft(), description: 'Drive account' }
    const onChange = vi.fn<(draft: AppUserAuthDraft) => void>()
    render(<ControlledHarness initialDraft={initialDraft} onChange={onChange} />)
    const oauth = screen.getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' })
    const apiKey = screen.getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' })
    expect(screen.getByText('plugin.auth.appUser.setupClient')).toBeVisible()
    await user.click(oauth)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(oauth).not.toHaveAttribute('aria-invalid', 'true')
    expect(apiKey).not.toHaveAttribute('aria-invalid', 'true')
    await user.click(apiKey)

    expect(onChange).toHaveBeenLastCalledWith({
      ...initialDraft,
      oauthEnabled: false,
      apiKeyEnabled: false,
    })
    expect(screen.getByText('plugin.auth.appUser.selectMethod')).toBeVisible()
    expect(oauth).toHaveAttribute('aria-invalid', 'true')
    expect(apiKey).toHaveAttribute('aria-invalid', 'true')
    expect(oauth).toHaveAccessibleDescription(/plugin\.auth\.appUser\.selectMethod/)
    expect(apiKey).toHaveAccessibleDescription(/plugin\.auth\.appUser\.selectMethod/)
    expect(
      screen.getByRole('group', { name: 'plugin.auth.authorization' }),
    ).toHaveAccessibleDescription('plugin.auth.appUser.selectMethod')

    await user.click(apiKey)
    expect(onChange).toHaveBeenLastCalledWith({
      ...initialDraft,
      oauthEnabled: false,
      apiKeyEnabled: true,
    })
    expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
    expect(oauth).not.toHaveAttribute('aria-invalid', 'true')
    expect(apiKey).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    await user.click(oauth)
    expect(screen.getByText('plugin.auth.appUser.setupClient')).toBeVisible()
    expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
  })

  it('keeps the OAuth client error while fixing the description and retains a saved client', async () => {
    const user = userEvent.setup()
    const initialDraft = createAppUserAuthDraft()
    const onChange = vi.fn<(draft: AppUserAuthDraft) => void>()
    render(<ControlledHarness initialDraft={initialDraft} onChange={onChange} />)
    const configureClient = screen.getByRole('button', {
      name: 'plugin.auth.appUser.configureClient',
    })
    expect(screen.getByText('plugin.auth.appUser.setupClient')).toBeVisible()
    expect(configureClient).toHaveAccessibleDescription('plugin.auth.appUser.setupClient')
    expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    await user.type(
      screen.getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }),
      'Drive account',
    )
    expect(screen.queryByText('plugin.auth.appUser.enterDescription')).not.toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.setupClient')).toBeVisible()
    await user.click(configureClient)
    const dialog = await screen.findByRole('dialog', { name: clientDialogName })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(screen.getByText('plugin.auth.appUser.setupClient')).toBeVisible()

    await saveCustomClient(user)
    expect(onChange).toHaveBeenLastCalledWith({
      ...initialDraft,
      description: 'Drive account',
      client: { type: 'custom', clientId: 'client-id', clientSecret: 'client-secret' },
    })
    expect(screen.queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }),
    ).not.toHaveAccessibleDescription()
    const oauth = screen.getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' })
    await user.click(oauth)
    await user.click(oauth)
    expect(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' })).toBeVisible()
    expect(onChange).toHaveBeenLastCalledWith({
      ...initialDraft,
      description: 'Drive account',
      client: { type: 'custom', clientId: 'client-id', clientSecret: 'client-secret' },
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('revalidates empty and whitespace descriptions immediately as the user edits', async () => {
    const user = userEvent.setup()
    const initialDraft = createAppUserAuthDraft({ canOAuth: false })
    const onChange = vi.fn<(draft: AppUserAuthDraft) => void>()
    render(<ControlledHarness initialDraft={initialDraft} onChange={onChange} />)
    const input = screen.getByRole('textbox', {
      name: 'plugin.auth.appUser.connectionDescription',
    })
    expect(screen.getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(/plugin\.auth\.appUser\.enterDescription/)
    expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    await user.type(input, '   ')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    await user.clear(input)
    await user.type(input, 'Connect your Drive account')
    expect(onChange).toHaveBeenLastCalledWith({
      ...initialDraft,
      description: 'Connect your Drive account',
    })
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('plugin.auth.appUser.enterDescription')).not.toBeInTheDocument()
    await user.clear(input)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
  })
})
