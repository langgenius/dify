import { render, screen } from '@testing-library/react'
import { useProviderContextSelector } from '../provider-context'
import { ProviderContextProvider } from '../provider-context-provider'

const mockFeaturesQuery = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: (options: { queryKey?: unknown[] }) =>
      String(options.queryKey?.[0]).includes('features')
        ? mockFeaturesQuery()
        : { data: undefined, isLoading: false, isSuccess: false, isFetched: false },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    features: {
      get: { queryOptions: () => ({ queryKey: ['features'] }), key: () => ['features'] },
    },
    workspaces: {
      current: {
        modelProviders: { summary: { get: { queryOptions: () => ({ queryKey: ['providers'] }) } } },
      },
    },
  },
}))

vi.mock('@/service/use-common', () => ({
  commonQueryKeys: { modelList: () => ['model-list'] },
  useModelListByType: () => ({ data: [] }),
  useSupportRetrievalMethods: () => ({ data: undefined }),
}))

vi.mock('@/app/components/base/zendesk/utils', () => ({ setZendeskConversationFields: vi.fn() }))

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()
  return { ...actual, useAtomValue: () => undefined }
})

const SkillFlag = () => {
  const enableSkill = useProviderContextSelector((state) => state.enableSkill)

  return <span data-testid="enable-skill">{String(enableSkill)}</span>
}

const renderProvider = () =>
  render(
    <ProviderContextProvider>
      <SkillFlag />
    </ProviderContextProvider>,
  )

const featuresResult = (data: unknown) => ({
  data,
  isLoading: false,
  isSuccess: !!data,
  isFetched: !!data,
})

const enabledFeatures = {
  billing: { enabled: false },
  education: { enabled: false },
  enable_skill: true,
  can_replace_logo: false,
  model_load_balancing_enabled: false,
  webapp_copyright_enabled: false,
  is_allow_transfer_workspace: false,
  knowledge_pipeline: { publish_enabled: false },
  human_input_email_delivery_enabled: false,
}

describe('ProviderContextProvider', () => {
  it('reports a feature as disabled before anything is known', () => {
    mockFeaturesQuery.mockReturnValue(featuresResult(undefined))
    renderProvider()

    expect(screen.getByTestId('enable-skill')).toHaveTextContent('false')
  })

  it('keeps the last known feature flags when the query briefly has no data', () => {
    mockFeaturesQuery.mockReturnValue(featuresResult(enabledFeatures))
    const { rerender } = renderProvider()

    expect(screen.getByTestId('enable-skill')).toHaveTextContent('true')

    // Anything gated on a flag would otherwise disappear and come back while the
    // query is without data, because every flag falls back to a disabled default.
    mockFeaturesQuery.mockReturnValue(featuresResult(undefined))
    rerender(
      <ProviderContextProvider>
        <SkillFlag />
      </ProviderContextProvider>,
    )

    expect(screen.getByTestId('enable-skill')).toHaveTextContent('true')
  })
})
