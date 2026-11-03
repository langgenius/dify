import type { ModelProvider } from '../../declarations'
import { act, waitFor } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import {
  ConfigurationMethodEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '../../declarations'
import { useChangeProviderPriority } from '../use-change-provider-priority'

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider =>
  ({
    provider: 'langgenius/openai/openai',
    configurate_methods: [
      ConfigurationMethodEnum.customizableModel,
      ConfigurationMethodEnum.predefinedModel,
    ],
    supported_model_types: [ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding],
    label: { en_US: 'OpenAI' },
    icon_small: { en_US: 'https://example.com/icon.png' },
    provider_credential_schema: { credential_form_schemas: [] },
    model_credential_schema: {
      model: {
        label: { en_US: 'Model' },
        placeholder: { en_US: 'Select model' },
      },
      credential_form_schemas: [],
    },
    ...overrides,
  }) as ModelProvider

function setup() {
  const view = renderHook(() => useChangeProviderPriority(createProvider()))
  const keys = [
    consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
      input: { params: { provider: 'langgenius/openai/openai' } },
    }),
    consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(),
    consoleQuery.workspaces.current.modelProviders.get.queryKey(),
    ...['llm', 'text-embedding'].map((model_type) =>
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type } },
      }),
    ),
  ]
  keys.forEach((key) => view.queryClient.setQueryData(key, { data: [] }))
  const unrelated = consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
    input: { params: { provider: 'other' } },
  })
  view.queryClient.setQueryData(unrelated, { data: [] })
  return { ...view, keys, unrelated }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ result: 'success' }))
})
afterEach(() => vi.restoreAllMocks())

it('submits provider preference and invalidates its models and supported model lists', async () => {
  const { result, queryClient, keys, unrelated } = setup()
  act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.custom))
  await waitFor(() => expect(queryClient.getQueryState(keys[0]!)?.isInvalidated).toBe(true))
  const request = vi.mocked(globalThis.fetch).mock.calls[0]![0] as Request
  expect(decodeURIComponent(request.url)).toContain(
    '/model-providers/langgenius/openai/openai/preferred-provider-type',
  )
  expect(await request.clone().json()).toEqual({
    preferred_provider_type: PreferredProviderTypeEnum.custom,
  })
  keys.forEach((key) => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true))
  expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false)
})

it('does not submit an empty provider identifier', () => {
  const { result } = renderHook(() => useChangeProviderPriority(undefined))
  act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.system))
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

it('shows the server failure once through the request layer without invalidating model caches', async () => {
  const response = createDeferred<Response>()
  vi.mocked(globalThis.fetch).mockReturnValue(response.promise)
  const notify = vi.spyOn(toast, 'error')
  const { result, queryClient, keys } = setup()
  act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.custom))
  await waitFor(() => expect(result.current.isChangingPriority).toBe(true))
  await act(async () =>
    response.resolve(
      Response.json({ code: 'bad_request', message: 'Priority unavailable' }, { status: 400 }),
    ),
  )
  await waitFor(() => expect(result.current.isChangingPriority).toBe(false))
  expect(notify).toHaveBeenCalledExactlyOnceWith('Priority unavailable')
  keys.forEach((key) => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false))
  expect(result.current.isChangingPriority).toBe(false)
})

it('exposes pending state until the preference is saved', async () => {
  const response = createDeferred<Response>()
  vi.mocked(globalThis.fetch).mockReturnValue(response.promise)
  const { result } = setup()
  act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.custom))
  await waitFor(() => expect(result.current.isChangingPriority).toBe(true))
  await act(async () => response.resolve(Response.json({ result: 'success' })))
  await waitFor(() => expect(result.current.isChangingPriority).toBe(false))
})
