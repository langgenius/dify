import type { Features, OnFeaturesChange } from '../../../types'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { FeaturesContext } from '../../../context'
import { createFeaturesStore } from '../../../store'
import Moderation from '../index'

const { mockCodeBasedExtensionData, mockSetShowModerationSettingModal } = vi.hoisted(() => ({
  mockCodeBasedExtensionData: [] as Array<{ name: string; label: Record<string, string> }>,
  mockSetShowModerationSettingModal: vi.fn(),
}))
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({ setShowModerationSettingModal: mockSetShowModerationSettingModal }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'codeBasedExtension.get': async () => ({ data: mockCodeBasedExtensionData }),
    }),
  }
})
const configured: NonNullable<Features['moderation']> = {
  enabled: true,
  type: 'keywords',
  config: {
    keywords: 'blocked',
    inputs_config: { enabled: true, preset_response: 'Input blocked' },
    outputs_config: { enabled: false, preset_response: '' },
  },
}
const renderModeration = (
  moderation: Features['moderation'] = { enabled: false },
  options: { disabled?: boolean; onChange?: OnFeaturesChange } = {},
) => {
  const store = createFeaturesStore()
  store.getState().setFeatures({ ...store.getState().features, moderation })
  const view = render(
    <FeaturesContext.Provider value={store}>
      <Moderation {...options} />
    </FeaturesContext.Provider>,
  )
  return { ...view, store }
}
const openSettings = async () => {
  const user = userEvent.setup({ skipHover: true })
  await user.hover(screen.getByText('appDebug.feature.moderation.title'))
  await user.click(screen.getByRole('button', { name: 'common.operation.settings' }))
}
const getModal = () =>
  mockSetShowModerationSettingModal.mock.calls.at(-1)![0] as {
    payload: Features['moderation']
    onSaveCallback: (value: Features['moderation']) => void
    onCancelCallback: () => void
  }

describe('Moderation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCodeBasedExtensionData.length = 0
  })

  it('opens initial configuration and enables moderation only after saving', async () => {
    const onChange = vi.fn()
    const { store } = renderModeration(undefined, { onChange })
    const toggle = screen.getByRole('switch')
    await userEvent.setup({ skipHover: true }).click(toggle)
    expect(getModal().payload).toMatchObject({
      enabled: true,
      type: 'keywords',
      config: { inputs_config: { enabled: true } },
    })
    expect(toggle).not.toBeChecked()
    expect(onChange).not.toHaveBeenCalled()
    act(() => getModal().onSaveCallback(configured))
    expect(toggle).toBeChecked()
    expect(store.getState().features.moderation).toEqual(configured)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(store.getState().features)
  })

  it('keeps moderation disabled when initial configuration is cancelled', async () => {
    const onChange = vi.fn()
    const { store } = renderModeration(undefined, { onChange })
    await userEvent.setup({ skipHover: true }).click(screen.getByRole('switch'))
    act(() => getModal().onCancelCallback())
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(store.getState().features.moderation).toEqual({ enabled: false })
    expect(onChange).toHaveBeenCalledExactlyOnceWith()
  })

  it('re-enables an existing configuration without reopening setup', async () => {
    const onChange = vi.fn()
    const { store } = renderModeration({ ...configured, enabled: false }, { onChange })
    await userEvent.setup({ skipHover: true }).click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toBeChecked()
    expect(store.getState().features.moderation).toEqual(configured)
    expect(mockSetShowModerationSettingModal).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(store.getState().features)
  })

  it('disables moderation and publishes the saved feature state', async () => {
    const onChange = vi.fn()
    const { store } = renderModeration(configured, { onChange })
    await userEvent.setup({ skipHover: true }).click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(store.getState().features.moderation).toEqual({ enabled: false })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(store.getState().features)
  })

  it.each([false, true])(
    'preserves other feature changes made while the modal is open (existing=%s)',
    async (existing) => {
      const { store } = renderModeration(existing ? configured : undefined)
      if (existing) await openSettings()
      else await userEvent.setup({ skipHover: true }).click(screen.getByRole('switch'))
      act(() =>
        store
          .getState()
          .setFeatures({ ...store.getState().features, suggested: { enabled: true } }),
      )
      const updated = { ...configured, type: 'openai_moderation' }
      act(() => getModal().onSaveCallback(updated))
      expect(store.getState().features).toMatchObject({
        moderation: updated,
        suggested: { enabled: true },
      })
      expect(screen.getByRole('switch')).toBeChecked()
    },
  )

  it('leaves an existing configuration intact when cancelling settings', async () => {
    const onChange = vi.fn()
    const { store } = renderModeration(configured, { onChange })
    await openSettings()
    expect(getModal().payload).toEqual(configured)
    act(() => getModal().onCancelCallback())
    expect(store.getState().features.moderation).toEqual(configured)
    expect(onChange).toHaveBeenCalledExactlyOnceWith()
  })

  it('disables both the feature toggle and settings for read-only users', async () => {
    const user = userEvent.setup({ skipHover: true })
    const onChange = vi.fn()
    const { store } = renderModeration(configured, { disabled: true, onChange })
    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    await user.click(toggle)
    await user.hover(screen.getByText('appDebug.feature.moderation.title'))
    const settings = screen.getByRole('button', { name: 'common.operation.settings' })
    expect(settings).toBeDisabled()
    await user.click(settings)
    expect(store.getState().features.moderation).toEqual(configured)
    expect(mockSetShowModerationSettingModal).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['keywords', 'appDebug.feature.moderation.modal.provider.keywords'],
    ['openai_moderation', 'appDebug.feature.moderation.modal.provider.openai'],
    ['api', 'common.apiBasedExtension.selector.title'],
    ['missing-extension', '-'],
  ])('identifies the configured provider %s', (type, label) => {
    renderModeration({ ...configured, type })
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('loads a custom provider label from the extension catalog', async () => {
    mockCodeBasedExtensionData.push({
      name: 'custom-ext',
      label: { 'en-US': 'Custom Moderation', 'zh-Hans': '自定义审核' },
    })
    renderModeration({ ...configured, type: 'custom-ext' })
    expect(await screen.findByText('Custom Moderation')).toBeInTheDocument()
  })

  it.each([
    [true, true, 'allEnabled'],
    [true, false, 'inputEnabled'],
    [false, true, 'outputEnabled'],
    [false, false, undefined],
  ] as const)(
    'shows enabled moderation directions (%s, %s)',
    (inputsEnabled, outputsEnabled, label) => {
      renderModeration({
        ...configured,
        config: {
          inputs_config: { enabled: inputsEnabled, preset_response: '' },
          outputs_config: { enabled: outputsEnabled, preset_response: '' },
        },
      })
      if (label)
        expect(screen.getByText(`appDebug.feature.moderation.${label}`)).toBeInTheDocument()
      else
        expect(
          screen.queryByText(/feature\.moderation\.(allEnabled|inputEnabled|outputEnabled)/),
        ).not.toBeInTheDocument()
    },
  )
})
