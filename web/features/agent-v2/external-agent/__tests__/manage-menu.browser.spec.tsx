import type { ExternalAgentAssetResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import {
  createExternalAgentAsset,
  createExternalAgentReferences,
} from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { ExternalAgentManageMenu } from '../manage-menu'
import { toExternalAgentListItem } from '../model'

// boundary: real translations provide the Manage menu and confirmation names for browser interaction.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

let asset: ExternalAgentAssetResponse
const fake = setupFakeApi({
  console: {
    externalAgents: {
      byAgentId: {
        enabled: { put: ({ body }) => ({ ...asset, enabled: body.enabled }) },
        references: { get: () => createExternalAgentReferences() },
        delete: () => undefined,
      },
    },
  },
})

async function setup({
  compact = false,
  role = 'owner',
}: { compact?: boolean; role?: 'owner' | 'editor' } = {}) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { wrapper: QueryProvider, queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { id: asset.tenant_id, role },
  })
  const navigation = createTestNavigation({ url: `/external-agent/${asset.id}/overview` })
  const { NavigationProvider } = navigation
  onTestFinished(() => queryClient.clear())
  await render(
    <QueryProvider>
      <NavigationProvider>
        <I18nextProvider i18n={i18n}>
          <div className="p-8">
            <ExternalAgentManageMenu agent={toExternalAgentListItem(asset)} compact={compact} />
          </div>
        </I18nextProvider>
      </NavigationProvider>
    </QueryProvider>,
  )
  return { navigation, trigger: page.getByRole('button', { name: 'Manage agent', exact: true }) }
}

beforeEach(() => {
  asset = createExternalAgentAsset()
})

async function chooseAction(action: 'Disable agent' | 'Enable agent' | 'Delete agent') {
  await page.getByRole('button', { name: 'Manage agent', exact: true }).click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

it('owns a disabling confirmation, blocks dismissal while saving and restores focus on success', async () => {
  const pending = hold(fake.console.externalAgents.byAgentId.enabled.put)
  const { trigger, navigation } = await setup()
  await chooseAction('Disable agent')
  const dialog = page.getByRole('alertdialog', { name: 'Disable agent?', exact: true })
  await dialog.getByRole('button', { name: 'Disable agent', exact: true }).click()
  await pending.arrived
  await expect.element(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  expect(navigation.router.replace).not.toHaveBeenCalled()
  pending.resolve({ ...asset, enabled: false })
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(fake.console.externalAgents.byAgentId.enabled.put).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: asset.id },
    body: { enabled: false },
  })
  expect(fake.console.externalAgents.byAgentId.delete).not.toHaveBeenCalled()
  expect(navigation.router.replace).not.toHaveBeenCalled()
})

it('enables a disabled Agent through the compact sidebar Manage button', async () => {
  asset = { ...asset, enabled: false }
  const { trigger } = await setup({ compact: true })
  await chooseAction('Enable agent')
  const dialog = page.getByRole('alertdialog', { name: 'Enable agent?', exact: true })
  await dialog.getByRole('button', { name: 'Enable agent', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(fake.console.externalAgents.byAgentId.enabled.put).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: asset.id },
    body: { enabled: true },
  })
})

it('waits for deletion impact and confirmed deletion before returning to the external roster', async () => {
  const references = hold(fake.console.externalAgents.byAgentId.references.get)
  const deletion = hold(fake.console.externalAgents.byAgentId.delete)
  const { navigation } = await setup()
  await chooseAction('Delete agent')
  const dialog = page.getByRole('alertdialog', { name: 'Delete agent?', exact: true })
  const remove = dialog.getByRole('button', { name: 'Delete agent', exact: true })
  await references.arrived
  await expect.element(remove).toBeDisabled()
  expect(fake.console.externalAgents.byAgentId.delete).not.toHaveBeenCalled()
  references.resolve(createExternalAgentReferences({ may_have_in_flight: true }))
  await expect.element(remove).toBeEnabled()
  await remove.click()
  await deletion.arrived
  await expect.element(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  expect(navigation.router.replace).not.toHaveBeenCalled()
  deletion.resolve(undefined)
  await expect.element(dialog).not.toBeInTheDocument()
  expect(fake.console.externalAgents.byAgentId.references.get).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: asset.id },
  })
  expect(fake.console.externalAgents.byAgentId.delete).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: asset.id },
  })
  expect(navigation.router.replace).toHaveBeenCalledExactlyOnceWith('/agents?agent_type=external')
})

it('switches Delete to Disable without changing the target Agent or issuing a delete', async () => {
  await setup()
  await chooseAction('Delete agent')
  const deletion = page.getByRole('alertdialog', { name: 'Delete agent?', exact: true })
  await expect
    .element(deletion.getByRole('button', { name: 'Delete agent', exact: true }))
    .toBeEnabled()
  await deletion.getByRole('button', { name: 'Disable agent', exact: true }).click()
  const disabling = page.getByRole('alertdialog', { name: 'Disable agent?', exact: true })
  await expect.element(disabling).toBeVisible()
  await expect.element(deletion).not.toBeInTheDocument()
  await disabling.getByRole('button', { name: 'Disable agent', exact: true }).click()
  await expect.element(disabling).not.toBeInTheDocument()
  expect(fake.console.externalAgents.byAgentId.enabled.put).toHaveBeenCalledExactlyOnceWith({
    params: { agent_id: asset.id },
    body: { enabled: false },
  })
  expect(fake.console.externalAgents.byAgentId.delete).not.toHaveBeenCalled()
})

it('keeps a failed confirmation open and clears its error before the next session', async () => {
  fake.console.externalAgents.byAgentId.enabled.put.mockRejectedValueOnce(
    apiError({ status: 503, message: 'Temporarily unavailable.' }),
  )
  const { trigger } = await setup()
  await chooseAction('Disable agent')
  const dialog = page.getByRole('alertdialog', { name: 'Disable agent?', exact: true })
  await dialog.getByRole('button', { name: 'Disable agent', exact: true }).click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Temporarily unavailable.')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await chooseAction('Disable agent')
  await expect.element(dialog).toBeVisible()
  await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
})

it('does not expose management or issue requests for a nonmanager', async () => {
  const { trigger } = await setup({ role: 'editor' })
  await expect.element(trigger).not.toBeInTheDocument()
  expect(fake.console.externalAgents.byAgentId.enabled.put).not.toHaveBeenCalled()
  expect(fake.console.externalAgents.byAgentId.references.get).not.toHaveBeenCalled()
  expect(fake.console.externalAgents.byAgentId.delete).not.toHaveBeenCalled()
})
