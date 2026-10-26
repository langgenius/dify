import type { Features, OnFeaturesChange } from '../../../types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { renderWithConfigurationModals } from '@/test/configuration-modals'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient } from '@/test/console/query-data'
import Moderation from '../index'

const { mockCodeBasedExtensionData } = vi.hoisted(() => ({
  mockCodeBasedExtensionData: [] as Array<{ name: string; label: Record<string, string> }>,
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
    outputs_config: { enabled: false },
  },
}
const renderModeration = (
  moderation: Features['moderation'] = { enabled: false },
  options: { disabled?: boolean; onChange?: OnFeaturesChange } = {},
) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.get.queryKey({ input: {} }),
    { data: [] },
  )
  const { featuresStore: store, ...view } = renderWithConfigurationModals(
    <Moderation {...options} />,
    { queryClient, initialFeatures: { moderation } },
  )
  return { ...view, store }
}
const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.hover(screen.getByText('appDebug.feature.moderation.title'))
  await user.click(screen.getByRole('button', { name: 'common.operation.settings' }))
  return screen.findByRole('dialog')
}
const closeModal = async (user: ReturnType<typeof userEvent.setup>, action: 'save' | 'cancel') => {
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: `common.operation.${action}` }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

describe('Moderation', () => {
  beforeEach(() => {
    mockCodeBasedExtensionData.length = 0
  })

  it('opens initial configuration and enables moderation only after saving', async () => {
    const user = userEvent.setup({ skipHover: true })
    const onChange = vi.fn()
    const { store } = renderModeration(undefined, { onChange })
    const toggle = screen.getByRole('switch')
    await user.click(toggle)
    const dialog = await screen.findByRole('dialog')
    expect(toggle).not.toBeChecked()
    expect(store.getState().features.moderation).toEqual({ enabled: false })
    expect(onChange).not.toHaveBeenCalled()
    await user.type(
      within(dialog).getByRole('textbox', {
        name: 'appDebug.feature.moderation.modal.provider.keywords',
      }),
      'blocked',
    )
    await user.click(
      within(dialog).getByRole('textbox', {
        name: 'appDebug.feature.moderation.modal.content.preset',
      }),
    )
    await user.paste('Input blocked')
    await closeModal(user, 'save')
    expect(toggle).toBeChecked()
    expect(store.getState().features.moderation).toEqual(configured)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(store.getState().features)
  })

  it('keeps moderation disabled when initial configuration is cancelled', async () => {
    const user = userEvent.setup({ skipHover: true })
    const onChange = vi.fn()
    const { store } = renderModeration(undefined, { onChange })
    await user.click(screen.getByRole('switch'))
    await closeModal(user, 'cancel')
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(store.getState().features.moderation).toEqual({ enabled: false })
    expect(onChange).toHaveBeenCalledExactlyOnceWith()
  })

  it('re-enables an existing configuration without reopening setup', async () => {
    const user = userEvent.setup({ skipHover: true })
    const onChange = vi.fn()
    const { store } = renderModeration({ ...configured, enabled: false }, { onChange })
    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toBeChecked()
    expect(store.getState().features.moderation).toEqual(configured)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledExactlyOnceWith(store.getState().features)
  })

  it('disables moderation and publishes the saved feature state', async () => {
    const user = userEvent.setup({ skipHover: true })
    const onChange = vi.fn()
    const { store } = renderModeration(configured, { onChange })
    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(store.getState().features.moderation).toEqual({ enabled: false })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(store.getState().features)
  })

  it.each([false, true])(
    'preserves other feature changes made while the modal is open (existing=%s)',
    async (existing) => {
      const user = userEvent.setup({ skipHover: true })
      const { store } = renderModeration(existing ? configured : undefined)
      if (existing) await openSettings(user)
      else await user.click(screen.getByRole('switch'))
      act(() =>
        store
          .getState()
          .setFeatures({ ...store.getState().features, suggested: { enabled: true } }),
      )
      const dialog = await screen.findByRole('dialog')
      const keywords = within(dialog).getByRole('textbox', {
        name: 'appDebug.feature.moderation.modal.provider.keywords',
      })
      await user.clear(keywords)
      await user.type(keywords, 'updated')
      const response = within(dialog).getByRole('textbox', {
        name: 'appDebug.feature.moderation.modal.content.preset',
      })
      if (!existing) {
        await user.click(response)
        await user.paste('Input blocked')
      }
      await closeModal(user, 'save')
      const updated = { ...configured, config: { ...configured.config, keywords: 'updated' } }
      expect(store.getState().features).toMatchObject({
        moderation: updated,
        suggested: { enabled: true },
      })
      expect(screen.getByRole('switch')).toBeChecked()
    },
  )

  it('leaves an existing configuration intact when cancelling settings', async () => {
    const user = userEvent.setup({ skipHover: true })
    const onChange = vi.fn()
    const { store } = renderModeration(configured, { onChange })
    const dialog = await openSettings(user)
    const keywords = within(dialog).getByRole('textbox', {
      name: 'appDebug.feature.moderation.modal.provider.keywords',
    })
    expect(keywords).toHaveValue('blocked')
    await user.type(keywords, ' unsaved')
    await closeModal(user, 'cancel')
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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
