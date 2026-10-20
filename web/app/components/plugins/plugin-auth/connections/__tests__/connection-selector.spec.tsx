import type { Credential } from '../../types'
import type { ConnectionSelectorDataSource } from '../connection-selector'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { PermissionLevel } from '@/models/permission'
import { CredentialTypeEnum } from '../../types'
import ConnectionSelector from '../connection-selector'

const personal: Credential = {
  id: 'personal',
  name: 'Personal Gmail',
  provider: 'gmail',
  credential_type: CredentialTypeEnum.OAUTH2,
  is_default: false,
  visibility: PermissionLevel.onlyMe,
}
const workspace: Credential = {
  ...personal,
  id: 'workspace',
  name: 'Workspace Gmail',
  visibility: PermissionLevel.allTeamMembers,
}
const warning = 'plugin.auth.connection.reauthorizationRequired'

const createDataSource = (
  overrides: Partial<ConnectionSelectorDataSource> = {},
): ConnectionSelectorDataSource => {
  const apiKey = { schemas: [], save: vi.fn().mockResolvedValue(undefined) }
  return {
    credentials: [workspace, personal],
    selectedCredential: personal,
    fallbackName: personal.name,
    canUse: true,
    canCreate: false,
    canOAuth: true,
    canApiKey: false,
    allowCustom: false,
    subtitle: (credential) =>
      credential?.id === personal.id ? 'evan.personal@gmail.com' : 'evan@dify.ai',
    select: vi.fn(),
    addOAuth: vi.fn(),
    openOAuthClientSettings: vi.fn(),
    apiKey,
    connectionActions: {
      canManageConnection: () => false,
      canEditConnection: () => false,
      remove: vi.fn().mockResolvedValue(undefined),
      edit: { canEdit: false, canUse: true, save: vi.fn().mockResolvedValue(undefined) },
      apiKey,
    },
    ...overrides,
  }
}

describe('ConnectionSelector connection status', () => {
  it('keeps a disabled picker native-disabled and allows opening after it is enabled', async () => {
    const user = userEvent.setup()
    const dataSource = createDataSource({ disabled: true })
    const { rerender } = render(<ConnectionSelector dataSource={dataSource} />)
    const trigger = screen.getByRole('button', { name: /Personal Gmail/ })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(
      screen.queryByRole('dialog', { name: 'plugin.auth.authorization' }),
    ).not.toBeInTheDocument()
    expect(dataSource.select).not.toHaveBeenCalled()

    rerender(<ConnectionSelector dataSource={{ ...dataSource, disabled: false }} />)
    expect(trigger).toBeEnabled()
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'plugin.auth.authorization' })).toBeVisible()
  })

  it('keeps a connection requiring reauthorization selected and allows switching away and back', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const Example = () => {
      const [selected, setSelected] = useState(personal)
      return (
        <ConnectionSelector
          dataSource={createDataSource({
            selectedCredential: selected,
            connectionStatusById: { [personal.id]: 'reauthorization-required' },
            select: (credential) => {
              onSelect(credential)
              setSelected(credential)
            },
          })}
        />
      )
    }
    render(<Example />)

    const trigger = screen.getByRole('button', { name: /Personal Gmail/ })
    expect(trigger).toHaveTextContent('evan.personal@gmail.com')
    expect(trigger).not.toHaveTextContent(warning)
    await user.click(trigger)
    const personalGroup = screen.getByRole('group', {
      name: 'datasetSettings.form.permissionsOnlyMe',
    })
    const personalOption = within(personalGroup).getByRole('button', { name: /Personal Gmail/ })
    expect(personalOption).toHaveAttribute('aria-pressed', 'true')
    expect(personalOption).toBeEnabled()
    expect(within(personalOption).getByText(warning)).toBeVisible()
    const workspaceGroup = screen.getByRole('group', { name: 'common.userProfile.workspace' })
    expect(within(workspaceGroup).queryByText(warning)).not.toBeInTheDocument()
    await user.click(within(workspaceGroup).getByRole('button', { name: /Workspace Gmail/ }))
    expect(onSelect).toHaveBeenLastCalledWith(workspace)
    await user.click(screen.getByRole('button', { name: /Workspace Gmail/ }))
    await user.click(
      within(
        screen.getByRole('group', { name: 'datasetSettings.form.permissionsOnlyMe' }),
      ).getByRole('button', { name: /Personal Gmail/ }),
    )
    expect(onSelect).toHaveBeenLastCalledWith(personal)
    expect(screen.getByRole('button', { name: /Personal Gmail/ })).toHaveTextContent(
      'evan.personal@gmail.com',
    )
  })

  it('does not infer reauthorization from unavailable or restricted credentials', async () => {
    const user = userEvent.setup()
    const restricted = { ...personal, not_allowed_to_use: true }
    render(
      <ConnectionSelector
        dataSource={createDataSource({
          credentials: [workspace, restricted],
          selectedCredential: restricted,
          unavailable: true,
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Personal Gmail/ }))
    expect(screen.queryByText(warning)).not.toBeInTheDocument()
    const personalGroup = screen.getByRole('group', {
      name: 'datasetSettings.form.permissionsOnlyMe',
    })
    expect(within(personalGroup).getByRole('button', { name: /Personal Gmail/ })).toBeDisabled()
  })

  it('does not infer reauthorization from a list loading failure', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ConnectionSelector dataSource={createDataSource({ loadError: { onRetry } })} />)
    const trigger = screen.getByRole('button', { name: /Personal Gmail/ })
    expect(trigger).toHaveTextContent('evan.personal@gmail.com')
    await user.click(trigger)
    expect(screen.getByText('plugin.auth.connection.loadError')).toBeVisible()
    expect(screen.queryByText(warning)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(trigger).toHaveTextContent('Personal Gmail')
  })

  it('does not mark an ordinary connection as requiring reauthorization', async () => {
    const user = userEvent.setup()
    render(<ConnectionSelector dataSource={createDataSource()} />)
    await user.click(screen.getByRole('button', { name: /Personal Gmail/ }))
    expect(screen.queryByText(warning)).not.toBeInTheDocument()
  })
})
