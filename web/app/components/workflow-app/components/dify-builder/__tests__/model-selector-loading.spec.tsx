import type { Resource } from 'i18next'
import type { ReactNode } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { Suspense } from 'react'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import englishCommon from '@/i18n/locales/en-US/common.json'
import englishBuilder from '@/i18n/locales/en-US/dify-builder.json'
import englishModelProvider from '@/i18n/locales/en-US/model-provider.json'
import englishPlugin from '@/i18n/locales/en-US/plugin.json'
import chineseCommon from '@/i18n/locales/zh-Hans/common.json'
import chineseBuilder from '@/i18n/locales/zh-Hans/dify-builder.json'
import chineseModelProvider from '@/i18n/locales/zh-Hans/model-provider.json'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import DifyBuilderComposer from '../composer'
import { DifyBuilderLocaleProvider } from '../interactions/locale-provider'
import DifyBuilderModelSelector from '../model-selector'
import { createSessionView } from '../session/__tests__/fixtures'
import { difyBuilderSessionViewAtom } from '../session/state'

vi.unmock('react-i18next')

const loadResource = vi.hoisted(() => vi.fn())

vi.mock('@/i18n/load-resource', () => ({ loadI18nResource: loadResource }))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/hooks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/header/account-setting/model-provider-page/hooks')
    >()),
    useTextGenerationCurrentProviderAndModelAndModelList: () => ({
      currentProvider: undefined,
      currentModel: undefined,
      activeTextGenerationModelList: [],
    }),
  }),
)

vi.mock('@/service/use-common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-common')>()),
  useModelParameterRules: () => ({ data: { data: [] }, isLoading: false }),
}))

vi.mock('../use-dify-builder-model', () => ({
  useDifyBuilderModel: () => ({
    model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
    selection: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
    modelList: [],
    hasAvailableModels: true,
    isLoading: false,
    isError: false,
  }),
}))

const renderSelector = (resource: Resource, children: ReactNode) => {
  const store = createStore()
  const queryClient = createConsoleQueryClient()
  store.set(queryClientAtom, queryClient)
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions().queryKey,
    { data: [], plugins: {} },
  )
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.credits.get.queryOptions().queryKey,
    {
      exhausted_at: null,
      is_exhausted: false,
      is_unlimited: true,
      next_credit_reset_date: null,
      pool_type: 'paid',
      quota_limit: null,
      quota_used: 0,
      remaining_credits: null,
    },
  )
  store.set(
    difyBuilderSessionViewAtom,
    createSessionView({
      phase: 'understand',
      reply_language: 'zh-Hans',
      run_status: 'waiting_input',
    }),
  )
  renderWithConsoleQuery(
    <Provider store={store}>
      <I18nClientProvider locale="en-US" resource={resource}>
        <NuqsTestingAdapter>
          <Suspense fallback={<p>Loading composer</p>}>
            <DifyBuilderLocaleProvider>{children}</DifyBuilderLocaleProvider>
          </Suspense>
        </NuqsTestingAdapter>
      </I18nClientProvider>
    </Provider>,
    { queryClient },
  )
}

beforeEach(() => {
  loadResource.mockReset()
})

it('keeps the model selector visible while its detected-language translations load', async () => {
  let resolveTranslations!: () => void
  const loaded = new Promise<void>((resolve) => {
    resolveTranslations = resolve
  })
  loadResource.mockImplementation(async () => {
    await loaded
    return { default: chineseModelProvider }
  })
  renderSelector(
    {
      'en-US': {
        common: englishCommon,
        difyBuilder: englishBuilder,
        modelProvider: englishModelProvider,
      },
      'zh-Hans': { common: chineseCommon, difyBuilder: chineseBuilder },
    },
    <DifyBuilderModelSelector selection={null} modelList={[]} />,
  )
  await waitFor(() => expect(loadResource).toHaveBeenCalledWith('zh-Hans', 'modelProvider'))

  expect(
    screen.getByRole('button', { name: englishModelProvider['modelProvider.model'] }),
  ).toBeVisible()
  expect(screen.queryByText('Loading composer')).not.toBeInTheDocument()

  await act(async () => resolveTranslations())

  expect(
    await screen.findByRole('button', { name: chineseModelProvider['modelProvider.model'] }),
  ).toBeVisible()
  expect(screen.queryByText('Loading composer')).not.toBeInTheDocument()
})

it('keeps the real composer mounted while the real model popup cold-loads translations', async () => {
  const user = userEvent.setup()
  let resolveTranslations!: () => void
  const pending = new Promise<void>((resolve) => {
    resolveTranslations = resolve
  })
  loadResource.mockImplementation(async () => {
    await pending
    return { default: englishPlugin }
  })
  renderSelector(
    {
      'en-US': {
        common: englishCommon,
        difyBuilder: englishBuilder,
        modelProvider: englishModelProvider,
      },
      'zh-Hans': {
        common: chineseCommon,
        difyBuilder: chineseBuilder,
        modelProvider: chineseModelProvider,
      },
    },
    <DifyBuilderComposer />,
  )

  const trigger = screen.getByRole('button', { name: 'gpt-4o' })
  const input = screen.getByRole('textbox', { name: chineseBuilder.messagePlaceholder })
  await user.type(input, 'Keep this composer draft')
  expect(loadResource).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  await user.click(trigger)
  await waitFor(() => expect(loadResource).toHaveBeenCalledWith('en-US', 'plugin'))

  expect(within(screen.getByRole('dialog')).getByRole('status')).toBeVisible()
  expect(screen.getByRole('button', { name: 'gpt-4o' })).toBe(trigger)
  expect(input).toBeVisible()
  expect(screen.queryByText('Loading composer')).not.toBeInTheDocument()
  expect(loadResource).not.toHaveBeenCalledWith('en-US', 'appDebug')

  await act(async () => resolveTranslations())

  expect(
    await screen.findByRole('dialog', {
      name: englishModelProvider['modelProvider.modelSettings'],
    }),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: englishCommon['operation.close'] }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
  expect(screen.getByRole('textbox', { name: chineseBuilder.messagePlaceholder })).toBe(input)
  expect(input).toHaveValue('Keep this composer draft')
  expect(screen.queryByText('Loading composer')).not.toBeInTheDocument()
})

it('keeps a selected model and composer visible when both model dictionaries are cold', async () => {
  const user = userEvent.setup()
  let resolveTranslations!: () => void
  const pending = new Promise<void>((resolve) => {
    resolveTranslations = resolve
  })
  loadResource.mockImplementation(async (locale: string) => {
    await pending
    return { default: locale === 'en-US' ? englishModelProvider : chineseModelProvider }
  })
  renderSelector(
    {
      'en-US': { common: englishCommon, difyBuilder: englishBuilder },
      'zh-Hans': { common: chineseCommon, difyBuilder: chineseBuilder },
    },
    <DifyBuilderComposer />,
  )
  await waitFor(() => expect(loadResource).toHaveBeenCalledWith('en-US', 'modelProvider'))

  const trigger = screen.getByRole('button', { name: 'gpt-4o' })
  const input = screen.getByRole('textbox', { name: chineseBuilder.messagePlaceholder })
  await user.type(input, 'Draft during model translation loading')
  expect(screen.queryByText('Loading composer')).not.toBeInTheDocument()

  await act(async () => resolveTranslations())

  expect(screen.getByRole('button', { name: 'gpt-4o' })).toBe(trigger)
  expect(screen.getByRole('textbox', { name: chineseBuilder.messagePlaceholder })).toBe(input)
  expect(input).toHaveValue('Draft during model translation loading')
  expect(input).toHaveFocus()
  expect(screen.queryByText('Loading composer')).not.toBeInTheDocument()
  expect(loadResource).not.toHaveBeenCalledWith('en-US', 'appDebug')
})
