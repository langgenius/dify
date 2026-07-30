import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { AppACLPermission } from '@/utils/permission'
import AppDeploy from '..'
import { EnvironmentTable } from '../environment-table'

let appPermissionKeys: string[] = [AppACLPermission.Deploy]
const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return createReactI18nextMock({
    'common.operation.cancel': 'Cancel',
    'deployments.deployTab.confirmUndeploy': 'Undeploy',
    'deployments.deployTab.undeployConfirmDesc':
      'The environment endpoint will become unavailable, but the version will not be deleted.',
    'deployments.deployTab.undeployConfirmTitle': 'Undeploy {{name}}?',
    'deployments.deployTab.undeployConfirmWarning':
      'After confirmation, this environment will enter the undeploying state and actions will be temporarily disabled.',
    'workflow.common.publishedBy': 'Published {{time}} by {{author}}',
  })
})

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => '17 days ago',
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      appDetail: {
        id: 'app-1',
        mode: 'workflow',
        maintainer: 'user-2',
        permission_keys: appPermissionKeys,
      },
    }),
}))

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')
  return createAccountStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

describe('AppDeploy', () => {
  beforeEach(() => {
    appPermissionKeys = [AppACLPermission.Deploy]
  })

  it('renders the built-in environment and mock deployment list', () => {
    render(<AppDeploy />)

    expect(
      screen.getByRole('heading', { name: 'deployments.studio.builtInTitle' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'deployments.studio.environments' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /Staging/ })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /Canary/ })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /Preview/ })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(9)
  })

  it('does not render deployment controls without app deploy ACL permission', () => {
    appPermissionKeys = []

    render(<AppDeploy />)

    expect(
      screen.queryByRole('heading', { name: 'common.appMenus.deploy' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'deployments.studio.environments' }),
    ).not.toBeInTheDocument()
  })

  it('opens the deploy menu with undeployed environments', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))

    expect(screen.getByText('deployments.card.notDeployed')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Testing/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /US-Prod/ })).toBeInTheDocument()
  })

  it('opens the selected environment version picker from the deploy menu', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))
    await user.click(screen.getByRole('menuitem', { name: /Dev/ }))

    const dialog = await screen.findByRole('dialog', {
      name: 'deployments.versions.deployTo:{"name":"Dev"}',
    })
    expect(within(dialog).getByText('deployments.studio.chooseVersionToDeploy')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /#6/ })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: /Sprint-42/ })).toBeDisabled()
  })

  it('continues from version selection to deployment configuration', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))
    await user.click(screen.getByRole('menuitem', { name: /Dev/ }))
    const versionDialog = await screen.findByRole('dialog', {
      name: 'deployments.versions.deployTo:{"name":"Dev"}',
    })
    await user.click(within(versionDialog).getByRole('button', { name: /#5/ }))

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    expect(within(configurationDialog).getByText('#5')).toBeInTheDocument()
    expect(within(configurationDialog).getByText('Dev')).toBeInTheDocument()
    expect(
      within(configurationDialog).getByRole('combobox', { name: 'Moonshot' }),
    ).toHaveTextContent('Enterprise key')

    const portSource = within(configurationDialog).getByRole('combobox', { name: /PORT/ })
    expect(portSource).toHaveTextContent('deployments.studio.configureValue')
    expect(within(configurationDialog).getByRole('textbox', { name: 'PORT' })).toBeDisabled()

    await user.click(portSource)
    expect(
      await screen.findByRole('option', {
        name: 'deployments.deployDrawer.envVarSource.literal',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'deployments.studio.configureValue' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', {
        name: 'deployments.deployDrawer.envVarSource.lastDeployment',
      }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('option', {
        name: 'deployments.deployDrawer.envVarSource.literal',
      }),
    )

    const customPortInput = within(configurationDialog).getByRole('spinbutton', { name: 'PORT' })
    expect(customPortInput).toBeEnabled()
    await user.clear(customPortInput)
    await user.type(customPortInput, '3000')
    expect(customPortInput).toHaveValue(3000)

    await user.click(
      within(configurationDialog).getByRole('button', { name: 'common.operation.back' }),
    )
    expect(
      await screen.findByRole('dialog', {
        name: 'deployments.versions.deployTo:{"name":"Dev"}',
      }),
    ).toBeInTheDocument()
  })

  it('opens the latest version configuration and allows choosing another version', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const preReleaseRow = screen.getByRole('row', { name: /Pre-release/ })
    await user.click(
      within(preReleaseRow).getByRole('button', {
        name: 'deployments.studio.deployLatest',
      }),
    )

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    expect(within(configurationDialog).getByText('#6')).toBeInTheDocument()
    expect(within(configurationDialog).getByText('Pre-release')).toBeInTheDocument()

    await user.click(
      within(configurationDialog).getByRole('button', { name: 'common.operation.back' }),
    )

    expect(
      await screen.findByRole('dialog', {
        name: 'deployments.studio.changeVersion · Pre-release',
      }),
    ).toBeInTheDocument()
  })

  it('opens the failed version configuration for retry without a version-selection step', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const previewRow = screen.getByRole('row', { name: /Preview/ })
    await user.click(
      within(previewRow).getByRole('button', {
        name: 'deployments.studio.retryVersion:{"version":"Sprint-42"}',
      }),
    )

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    expect(within(configurationDialog).getByText('Sprint-42')).toBeInTheDocument()
    expect(within(configurationDialog).getByText('Preview')).toBeInTheDocument()
    expect(
      within(configurationDialog).queryByRole('button', { name: 'common.operation.back' }),
    ).not.toBeInTheDocument()
  })

  it('opens redeploy configuration without a version-selection step', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const qaRow = screen.getByRole('row', { name: /QA/ })
    await user.click(
      within(qaRow).getByRole('button', {
        name: 'deployments.deployTab.redeploy',
      }),
    )

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    expect(within(configurationDialog).getByText('v0.3-beta')).toBeInTheDocument()
    expect(within(configurationDialog).getByText('QA')).toBeInTheDocument()
    expect(
      within(configurationDialog).queryByRole('button', { name: 'common.operation.back' }),
    ).not.toBeInTheDocument()
  })

  it('opens change version for the selected deployed environment', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const canaryRow = screen.getByRole('row', { name: /Canary/ })
    await user.click(
      within(canaryRow).getByRole('button', {
        name: 'deployments.studio.changeVersion',
      }),
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.changeVersion · Canary',
    })
    expect(within(dialog).getByRole('button', { name: /Sprint-42/ })).toBeDisabled()
    expect(within(dialog).getByText('deployments.studio.current')).toBeInTheDocument()
  })

  it('shows the empty deployment state when there are no environments in use', async () => {
    const user = userEvent.setup()
    render(<EnvironmentTable deployments={[]} />)

    expect(screen.getByText('deployments.list.emptyTitle')).toBeInTheDocument()
    expect(screen.getByText('deployments.studio.emptyDescription')).toBeInTheDocument()

    const deployButton = screen.getByRole('button', {
      name: 'deployments.studio.deployToEnvironment',
    })
    await user.click(deployButton)

    expect(screen.getByText('deployments.card.notDeployed')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Testing/ })).toBeInTheDocument()
  })

  it('shows the environment actions from the design menu', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const canaryRow = screen.getByRole('row', { name: /Canary/ })
    await user.click(
      within(canaryRow).getByRole('button', {
        name: 'Canary · deployments.deployTab.moreActions',
      }),
    )

    const menu = await screen.findByRole('menu', {
      name: 'Canary · deployments.deployTab.moreActions',
    })
    expect(
      within(menu).getByRole('menuitem', { name: 'deployments.studio.changeVersion' }),
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'deployments.deployTab.redeploy' }),
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'deployments.deployTab.undeploy' }),
    ).toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', {
        name: 'deployments.deployTab.deployOtherVersion',
      }),
    ).not.toBeInTheDocument()
  })

  it('asks for confirmation before undeploying an environment', async () => {
    const user = userEvent.setup()
    const onUndeploy = vi.fn()
    render(<EnvironmentTable onUndeploy={onUndeploy} />)

    const canaryRow = screen.getByRole('row', { name: /Canary/ })
    await user.click(
      within(canaryRow).getByRole('button', {
        name: 'Canary · deployments.deployTab.moreActions',
      }),
    )
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'deployments.deployTab.undeploy',
      }),
    )

    const dialog = await screen.findByRole('alertdialog', { name: 'Undeploy Canary?' })
    expect(
      within(dialog).getByText(
        'The environment endpoint will become unavailable, but the version will not be deleted.',
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'After confirmation, this environment will enter the undeploying state and actions will be temporarily disabled.',
      ),
    ).toBeInTheDocument()
    expect(onUndeploy).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onUndeploy).not.toHaveBeenCalled()
  })

  it('undeploys the selected environment after confirmation', async () => {
    const user = userEvent.setup()
    const onUndeploy = vi.fn()
    render(<EnvironmentTable onUndeploy={onUndeploy} />)

    const canaryRow = screen.getByRole('row', { name: /Canary/ })
    await user.click(
      within(canaryRow).getByRole('button', {
        name: 'Canary · deployments.deployTab.moreActions',
      }),
    )
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'deployments.deployTab.undeploy',
      }),
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Undeploy Canary?' })

    await user.click(within(dialog).getByRole('button', { name: 'Undeploy' }))

    expect(onUndeploy).toHaveBeenCalledOnce()
    expect(onUndeploy).toHaveBeenCalledWith(expect.objectContaining({ id: 'canary' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows publication details and the version description on hover', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const canaryRow = screen.getByRole('row', { name: /Canary/ })
    await user.hover(within(canaryRow).getByRole('button', { name: 'Sprint-42' }))

    expect(await screen.findByText('Published 17 days ago by Minco')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Fixed several critical bugs affecting data synchronization and optimized page loading speed. Enhanced system stability and user experience through backend improvements.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the compact version preview when there is no description', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const builtInSection = screen
      .getByRole('heading', { name: 'deployments.studio.builtInTitle' })
      .closest('section')
    if (!builtInSection) throw new Error('Built-in environment section was not rendered')
    await user.hover(within(builtInSection).getByRole('button', { name: 'Sprint-42' }))

    expect(await screen.findByText('Published 17 days ago by Minco')).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Fixed several critical bugs affecting data synchronization and optimized page loading speed. Enhanced system stability and user experience through backend improvements.',
      ),
    ).not.toBeInTheDocument()
  })
})
