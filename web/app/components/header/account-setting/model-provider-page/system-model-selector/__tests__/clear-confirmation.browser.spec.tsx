import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { render } from 'vitest-browser-react'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import SystemModel from '../index'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.defaultModel.get': async ({
        query: { model_type },
      }: {
        query: { model_type: string }
      }) => ({
        data: model_type === 'llm' ? createDefaultModelFixture() : null,
      }),
    }),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock({
      'modelProvider.systemModelSettings': 'System Model Settings',
      'modelProvider.systemModelSettingsTitle': 'Default Model Settings',
      'modelProvider.systemReasoningModel.key': 'System Reasoning Model',
      'modelProvider.clearDefaultModel.title': 'Clear {{modelType}}?',
      'operation.cancel': 'Cancel',
      'operation.clear': 'Clear',
      'operation.save': 'Save',
    }),
  }
})

beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())

it('keeps the settings behind its nested confirmation and restores focus without losing the draft', async () => {
  // Real browser focus verifies returning to a surviving clear button or Save after that button disappears.
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['plugin.model_config'],
  })
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture(),
        createCatalogModelFixture({ model: 'edited-model', label: { en_US: 'Edited model' } }),
      ],
    }),
  ])
  const screen = await render(
    <NuqsTestingAdapter>
      <Wrapper>
        <SystemModel notConfigured={false} />
      </Wrapper>
    </NuqsTestingAdapter>,
  )
  await screen.getByRole('button', { name: 'System Model Settings' }).click()
  const settings = screen.getByRole('dialog', { name: 'Default Model Settings' })
  await expect.element(settings).toBeVisible()
  await settings.getByRole('button', { name: /^GPT-4/ }).click()
  await screen
    .getByRole('dialog', { name: 'plugin.detailPanel.configureModel' })
    .getByRole('button', { name: /^Edited model/ })
    .click()
  await expect.element(settings.getByRole('button', { name: /^Edited model/ })).toBeVisible()

  const settingsPopup = settings.element()
  try {
    await settings.getByRole('button', { name: 'Clear System Reasoning Model' }).click()
    const confirmation = screen.getByRole('alertdialog', { name: 'Clear System Reasoning Model?' })
    await expect.element(confirmation).toBeVisible()
    await expect.element(settingsPopup).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect.element(settings).toBeVisible()
    await expect.element(settings.getByRole('button', { name: /^Edited model/ })).toBeVisible()
    await expect
      .element(settings.getByRole('button', { name: 'Clear System Reasoning Model' }))
      .toHaveFocus()

    await settings.getByRole('button', { name: 'Clear System Reasoning Model' }).click()
    await expect.element(confirmation).toBeVisible()
    await expect.element(settingsPopup).toBeVisible()
    await confirmation.getByRole('button', { name: 'Clear' }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect.element(settings).toBeVisible()
    await expect.element(settings.getByRole('button', { name: 'Save' })).toHaveFocus()
    await expect
      .element(settings.getByRole('button', { name: 'Clear System Reasoning Model' }))
      .not.toBeInTheDocument()
  } finally {
    queryClient.clear()
  }
})
