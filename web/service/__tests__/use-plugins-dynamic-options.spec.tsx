import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useFetchDynamicOptions, useFetchDynamicTreeOptions } from '../use-plugins'

const { mockGet, mockDynamicTreeGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockDynamicTreeGet: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  get: mockGet,
  getMarketplace: vi.fn(),
  post: vi.fn(),
  postMarketplace: vi.fn(),
}))

vi.mock('@/service/console', () => ({
  consoleClient: {
    workspaces: {
      current: {
        plugin: {
          parameters: {
            dynamicTreeOptions: {
              get: mockDynamicTreeGet,
            },
          },
        },
      },
    },
  },
  consoleQuery: {},
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({
    refreshPluginList: vi.fn(),
  }),
}))

vi.mock('../use-tools', () => ({
  useInvalidateAllBuiltInTools: () => vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('dynamic plugin option hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should request dynamic options with credential and sibling parameter values', async () => {
    mockGet.mockResolvedValue({ options: [] })
    const { result } = renderHook(
      () =>
        useFetchDynamicOptions({
          plugin_id: 'plugin-1',
          provider: 'provider-1',
          action: 'search',
          parameter: 'region',
          credential_id: 'credential-1',
          parameter_values: { region: 'us' },
        }),
      { wrapper: createWrapper() },
    )

    await result.current.mutateAsync()

    expect(mockGet).toHaveBeenCalledWith('/workspaces/current/plugin/parameters/dynamic-options', {
      params: {
        plugin_id: 'plugin-1',
        provider: 'provider-1',
        action: 'search',
        parameter: 'region',
        provider_type: 'tool',
        credential_id: 'credential-1',
        parameter_values: JSON.stringify({ region: 'us' }),
      },
    })
  })

  it('should omit empty credential and parameter values from dynamic option requests', async () => {
    mockGet.mockResolvedValue({ options: [] })
    const { result } = renderHook(
      () =>
        useFetchDynamicOptions({
          plugin_id: 'plugin-1',
          provider: 'provider-1',
          action: 'search',
          parameter: 'region',
          parameter_values: {},
        }),
      { wrapper: createWrapper() },
    )

    await result.current.mutateAsync()

    expect(mockGet).toHaveBeenCalledWith('/workspaces/current/plugin/parameters/dynamic-options', {
      params: {
        plugin_id: 'plugin-1',
        provider: 'provider-1',
        action: 'search',
        parameter: 'region',
        provider_type: 'tool',
      },
    })
  })

  it('should map tree option labels, icons, and nested children', async () => {
    mockDynamicTreeGet.mockResolvedValue({
      options: [
        {
          value: 'parent',
          icon: null,
          label: { en_US: 'Parent' },
          children: [
            {
              value: 'child',
              icon: '/child.svg',
              label: {
                en_US: 'Child',
                zh_Hans: '子节点',
                ja_JP: '子',
                pt_BR: 'Filho',
              },
            },
          ],
        },
      ],
    })
    const { result } = renderHook(
      () =>
        useFetchDynamicTreeOptions({
          plugin_id: 'plugin-1',
          provider: 'provider-1',
          action: 'search',
          parameter: 'category',
          credential_id: 'credential-1',
          parameter_values: { region: 'us' },
        }),
      { wrapper: createWrapper() },
    )

    const data = await result.current.mutateAsync()

    expect(mockDynamicTreeGet).toHaveBeenCalledWith({
      query: {
        plugin_id: 'plugin-1',
        provider: 'provider-1',
        action: 'search',
        parameter: 'category',
        credential_id: 'credential-1',
        parameter_values: JSON.stringify({ region: 'us' }),
      },
    })
    expect(data).toEqual({
      options: [
        {
          value: 'parent',
          label: { en_US: 'Parent', zh_Hans: 'Parent' },
          show_on: [],
          icon: undefined,
          children: [
            {
              value: 'child',
              label: { en_US: 'Child', zh_Hans: '子节点', ja_JP: '子', pt_BR: 'Filho' },
              show_on: [],
              icon: '/child.svg',
              children: undefined,
            },
          ],
        },
      ],
    })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
  })
})
