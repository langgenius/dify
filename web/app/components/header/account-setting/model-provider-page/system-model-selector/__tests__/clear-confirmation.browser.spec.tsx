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
      'operation.reset': 'Reset',
      'operation.save': 'Save',
    }),
  }
})

beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())

it('replaces the settings surface with its confirmation while preserving the backdrop, draft and return focus', async () => {
  // Real CSS and animation frames expose overlapping surfaces or a flashing backdrop that unit tests cannot see.
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
        <SystemModel
          textGenerationDefaultModel={createDefaultModelFixture()}
          embeddingsDefaultModel={undefined}
          rerankDefaultModel={undefined}
          speech2textDefaultModel={undefined}
          ttsDefaultModel={undefined}
          notConfigured={false}
        />
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
  const backdrop = document.elementFromPoint(4, 4)
  if (!(backdrop instanceof HTMLElement)) throw new Error('Expected the visible dialog backdrop')
  await expect.element(backdrop).toHaveAttribute('role', 'presentation')
  await expect.poll(() => getComputedStyle(backdrop).opacity).toBe('1')
  let confirmationPopup: Element | undefined
  let closing = false
  const frames: {
    backdropConnected: boolean
    backdropVisible: boolean
    backdropOpacity: number
    closingConfirmationVisible: boolean
    settingsVisible: boolean
  }[] = []
  let frameId = 0
  const sampleFrame = () => {
    const backdropStyle = getComputedStyle(backdrop)
    const confirmationOpacity = confirmationPopup?.isConnected
      ? Number(getComputedStyle(confirmationPopup).opacity)
      : 0
    frames.push({
      backdropConnected: backdrop.isConnected,
      backdropVisible: backdrop.checkVisibility({ visibilityProperty: true }),
      backdropOpacity: Number(backdropStyle.opacity),
      closingConfirmationVisible: closing && confirmationOpacity > 0 && confirmationOpacity < 1,
      settingsVisible: settingsPopup.checkVisibility({ visibilityProperty: true }),
    })
    frameId = requestAnimationFrame(sampleFrame)
  }
  sampleFrame()

  try {
    await settings.getByRole('button', { name: 'Reset System Reasoning Model' }).click()
    const confirmation = screen.getByRole('alertdialog', { name: 'Clear System Reasoning Model?' })
    await expect.element(confirmation).toBeVisible()
    await expect.element(settingsPopup).not.toBeVisible()
    confirmationPopup = confirmation.element()
    await expect.poll(() => getComputedStyle(confirmationPopup!).opacity).toBe('1')
    closing = true
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    closing = false
    await expect.element(settings).toBeVisible()
    await expect.element(settings.getByRole('button', { name: /^Edited model/ })).toBeVisible()
    expect(document.elementFromPoint(4, 4)).toBe(backdrop)

    await settings.getByRole('button', { name: 'Reset System Reasoning Model' }).click()
    await expect.element(confirmation).toBeVisible()
    await expect.element(settingsPopup).not.toBeVisible()
    confirmationPopup = confirmation.element()
    await expect.poll(() => getComputedStyle(confirmationPopup!).opacity).toBe('1')
    closing = true
    await confirmation.getByRole('button', { name: 'Clear' }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    closing = false
    await expect.element(settings).toBeVisible()
    await expect.element(settings.getByRole('button', { name: 'Save' })).toHaveFocus()
    await expect
      .element(settings.getByRole('button', { name: 'Reset System Reasoning Model' }))
      .not.toBeInTheDocument()
    expect(document.elementFromPoint(4, 4)).toBe(backdrop)

    expect(frames.every((frame) => frame.backdropConnected && frame.backdropVisible)).toBe(true)
    expect(frames.every((frame) => frame.backdropOpacity === 1)).toBe(true)
    const closingFrames = frames.filter((frame) => frame.closingConfirmationVisible)
    expect(closingFrames.length).toBeGreaterThan(0)
    expect(closingFrames.every((frame) => !frame.settingsVisible)).toBe(true)
  } finally {
    cancelAnimationFrame(frameId)
    queryClient.clear()
  }
})
