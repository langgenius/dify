/**
 * Integration test: Explore App List Flow
 *
 * Tests the end-to-end user flow of browsing, filtering, searching,
 * and adding apps to workspace from the explore page.
 */
import type { Mock } from 'vitest'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { App } from '@/models/explore'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import {
  createTestQueryClient,
  renderWithSystemFeatures as render,
} from '@/__tests__/utils/mock-system-features'
import AppList from '@/app/components/explore/app-list'
import { fetchAppDetail, fetchAppList, fetchBanners } from '@/service/explore'
import { useMembers } from '@/service/use-common'
import { AppModeEnum } from '@/types/app'

type MockAppContext = {
  userProfile: { id: string }
  workspacePermissionKeys: string[]
}

const mockUseAppContext = vi.hoisted(() => vi.fn<() => MockAppContext>())

const allCategoriesEn = 'explore.apps.allCategories:{"lng":"en-US"}'
let mockTabValue = allCategoriesEn
const mockSetTab = vi.fn()
let mockExploreData: { categories: string[]; allList: App[] } | undefined
let mockIsLoading = false
const mockHandleImportDSL = vi.fn()
const mockHandleImportDSLConfirm = vi.fn()

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryState: () => [mockTabValue, mockSetTab],
  }
})

vi.mock('ahooks', async () => {
  const actual = await vi.importActual<typeof import('ahooks')>('ahooks')
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useDebounceFn: (fn: (...args: unknown[]) => void) => {
      const fnRef = React.useRef(fn)
      fnRef.current = fn
      return {
        run: () => setTimeout(() => fnRef.current(), 0),
      }
    },
  }
})

vi.mock('@/service/use-explore', () => ({
  useLearnDifyAppList: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/service/explore', () => ({
  fetchAppDetail: vi.fn(),
  fetchAppList: vi.fn(),
  fetchBanners: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {},
  consoleQuery: {
    onboarding: {
      stepByStepTour: {
        state: {
          get: {
            queryOptions: () => ({
              initialData: {
                completed_task_ids: [],
                first_workspace_id: null,
                manually_disabled_workspace_ids: [],
                manually_enabled_workspace_ids: [],
                skipped: false,
                updated_at: null,
              },
              queryFn: () =>
                Promise.resolve({
                  completed_task_ids: [],
                  first_workspace_id: null,
                  manually_disabled_workspace_ids: [],
                  manually_enabled_workspace_ids: [],
                  skipped: false,
                  updated_at: null,
                }),
              queryKey: ['console', 'onboarding', 'stepByStepTour', 'state'],
            }),
          },
          patch: {
            mutationOptions: () => ({
              mutationFn: () =>
                Promise.resolve({
                  completed_task_ids: [],
                  first_workspace_id: null,
                  manually_disabled_workspace_ids: [],
                  manually_enabled_workspace_ids: [],
                  skipped: false,
                  updated_at: null,
                }),
            }),
          },
        },
      },
    },
    systemFeatures: {
      get: {
        queryKey: () => ['console', 'systemFeatures'],
      },
    },
    apps: {
      get: {
        queryOptions: (options: {
          input?: { query?: { limit?: number } }
          select?: (response: {
            data: []
            has_more: boolean
            limit: number
            page: number
            total: number
          }) => unknown
        }) => {
          const limit = options.input?.query?.limit ?? 0
          const response = {
            data: [],
            has_more: false,
            limit,
            page: 1,
            total: 0,
          }
          return {
            queryKey: ['console', 'apps', 'get', options.input],
            queryFn: () => Promise.resolve(response),
            initialData: response,
            select: options.select,
          }
        },
      },
    },
    explore: {
      apps: {
        get: {
          queryKey: ({ input }: { input?: unknown } = {}) => [
            'console',
            'explore',
            'apps',
            'get',
            input,
          ],
        },
      },
      banners: {
        get: {
          queryKey: ({ input }: { input?: unknown } = {}) => [
            'console',
            'explore',
            'banners',
            'get',
            input,
          ],
        },
      },
    },
  },
}))

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockUseAppContext())
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockUseAppContext())
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockUseAppContext())
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockUseAppContext())
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => mockUseAppContext())
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } =
    await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/service/use-common', () => ({
  useMembers: vi.fn(),
}))

vi.mock('@/hooks/use-import-dsl', () => ({
  useImportDSL: () => ({
    handleImportDSL: mockHandleImportDSL,
    handleImportDSLConfirm: mockHandleImportDSLConfirm,
    versions: ['v1'],
    isFetching: false,
  }),
}))

vi.mock('@/app/components/explore/create-app-modal', () => ({
  default: (props: CreateAppModalProps) => {
    if (!props.show) return null
    return (
      <div data-testid="create-app-modal">
        <button
          data-testid="confirm-create"
          onClick={() =>
            props.onConfirm({
              name: 'New App',
              icon_type: 'emoji',
              icon: '🤖',
              icon_background: '#fff',
              description: 'desc',
            })
          }
        >
          confirm
        </button>
        <button data-testid="hide-create" onClick={props.onHide}>
          hide
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/app/create-from-dsl-modal/dsl-confirm-modal', () => ({
  default: ({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="dsl-confirm-modal">
      <button data-testid="dsl-confirm" onClick={onConfirm}>
        confirm
      </button>
      <button data-testid="dsl-cancel" onClick={onCancel}>
        cancel
      </button>
    </div>
  ),
}))

const createApp = (overrides: Partial<App> = {}): App => ({
  app: {
    id: overrides.app?.id ?? 'app-id',
    mode: overrides.app?.mode ?? AppModeEnum.CHAT,
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '😀',
    icon_background: overrides.app?.icon_background ?? '#fff',
    icon_url: overrides.app?.icon_url ?? '',
    name: overrides.app?.name ?? 'Alpha',
    description: overrides.app?.description ?? 'Alpha description',
    use_icon_as_answer_icon: overrides.app?.use_icon_as_answer_icon ?? false,
  },
  can_trial: true,
  app_id: overrides.app_id ?? 'app-1',
  description: overrides.description ?? 'Alpha description',
  copyright: overrides.copyright ?? '',
  privacy_policy: overrides.privacy_policy ?? null,
  custom_disclaimer: overrides.custom_disclaimer ?? null,
  categories: overrides.categories ?? ['Writing'],
  position: overrides.position ?? 1,
  is_listed: overrides.is_listed ?? true,
  install_count: overrides.install_count ?? 0,
  installed: overrides.installed ?? false,
  editable: overrides.editable ?? false,
  is_agent: overrides.is_agent ?? false,
})

const mockMemberRole = (hasEditPermission: boolean) => {
  mockUseAppContext.mockReturnValue({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: hasEditPermission ? ['app.create_and_management'] : [],
  })
  vi.mocked(useMembers).mockReturnValue({
    data: {
      accounts: [{ id: 'user-1', role: hasEditPermission ? 'admin' : 'normal' }],
    },
  } as unknown as ReturnType<typeof useMembers>)
}

const localeInput = { query: { language: 'en-US' } }
const exploreAppListQueryKey = ['console', 'explore', 'apps', 'get', localeInput, 'en-US']
const homeContinueWorkAppsInput = {
  query: {
    page: 1,
    limit: 8,
    name: '',
  },
}

const createHomeQueryClient = () => {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['console', 'apps', 'get', homeContinueWorkAppsInput], {
    data: [],
    has_more: false,
    limit: 8,
    page: 1,
    total: 0,
  })

  if (!mockIsLoading && mockExploreData)
    queryClient.setQueryData(exploreAppListQueryKey, mockExploreData)

  return queryClient
}

const renderAppList = (hasEditPermission = true, onSuccess?: () => void) => {
  mockMemberRole(hasEditPermission)
  return render(<AppList onSuccess={onSuccess} />, {
    queryClient: createHomeQueryClient(),
  })
}

describe('Explore App List Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTabValue = allCategoriesEn
    mockIsLoading = false
    mockExploreData = {
      categories: ['Writing', 'Translate', 'Programming'],
      allList: [
        createApp({
          app_id: 'app-1',
          app: { ...createApp().app, name: 'Writer Bot' },
          categories: ['Writing'],
        }),
        createApp({
          app_id: 'app-2',
          app: { ...createApp().app, id: 'app-id-2', name: 'Translator' },
          categories: ['Translate'],
        }),
        createApp({
          app_id: 'app-3',
          app: { ...createApp().app, id: 'app-id-3', name: 'Code Helper' },
          categories: ['Programming'],
        }),
      ],
    }
    ;(fetchAppList as unknown as Mock).mockImplementation(() => new Promise(() => {}))
    ;(fetchBanners as unknown as Mock).mockResolvedValue([])
  })

  describe('Browse and Filter Flow', () => {
    it('should display all apps when no category filter is applied', () => {
      renderAppList()

      expect(screen.getByText('Writer Bot'))!.toBeInTheDocument()
      expect(screen.getByText('Translator'))!.toBeInTheDocument()
      expect(screen.getByText('Code Helper'))!.toBeInTheDocument()
    })

    it('should filter apps by selected category', () => {
      mockTabValue = 'Writing'
      renderAppList()

      expect(screen.getByText('Writer Bot'))!.toBeInTheDocument()
      expect(screen.queryByText('Translator')).not.toBeInTheDocument()
      expect(screen.queryByText('Code Helper')).not.toBeInTheDocument()
    })

    it('should only use categories when filtering by selected category', () => {
      mockTabValue = 'Writing'
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [
          createApp({
            app_id: 'app-1',
            app: { ...createApp().app, name: 'Active Writer' },
            categories: ['Writing'],
          }),
          createApp({
            app_id: 'app-2',
            app: { ...createApp().app, id: 'app-id-2', name: 'Legacy Writer' },
            categories: [],
          }),
        ],
      }

      renderAppList()

      expect(screen.getByText('Active Writer')).toBeInTheDocument()
      expect(screen.queryByText('Legacy Writer')).not.toBeInTheDocument()
    })

    it('should filter apps by search keyword', async () => {
      renderAppList()

      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'trans' } })

      await waitFor(() => {
        expect(screen.getByText('Translator'))!.toBeInTheDocument()
        expect(screen.queryByText('Writer Bot')).not.toBeInTheDocument()
        expect(screen.queryByText('Code Helper')).not.toBeInTheDocument()
      })
    })
  })

  describe('Add to Workspace Flow', () => {
    it('should complete the full add-to-workspace flow with DSL confirmation', async () => {
      // Step 1: User clicks "Add to Workspace" on an app card
      const onSuccess = vi.fn()
      ;(fetchAppDetail as unknown as Mock).mockResolvedValue({ export_data: 'yaml-content' })
      mockHandleImportDSL.mockImplementation(
        async (_payload: unknown, options: { onSuccess?: () => void; onPending?: () => void }) => {
          options.onPending?.()
        },
      )
      mockHandleImportDSLConfirm.mockImplementation(
        async (options: { onSuccess?: (payload: { app_mode: AppModeEnum }) => void }) => {
          options.onSuccess?.({ app_mode: AppModeEnum.CHAT })
        },
      )

      renderAppList(true, onSuccess)

      // Step 2: Click the app card - opens create modal in self-hosted/non-cloud mode
      fireEvent.click(screen.getByRole('button', { name: 'Writer Bot' }))

      // Step 3: Confirm creation in modal
      fireEvent.click(await screen.findByTestId('confirm-create'))

      // Step 4: API fetches app detail
      await waitFor(() => {
        expect(fetchAppDetail).toHaveBeenCalledWith('app-id')
      })

      // Step 5: DSL import triggers pending confirmation
      expect(mockHandleImportDSL).toHaveBeenCalledTimes(1)

      // Step 6: DSL confirm modal appears and user confirms
      expect(await screen.findByTestId('dsl-confirm-modal'))!.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('dsl-confirm'))

      // Step 7: Flow completes successfully
      await waitFor(() => {
        expect(mockHandleImportDSLConfirm).toHaveBeenCalledTimes(1)
        expect(onSuccess).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Loading and Empty States', () => {
    it('should transition from loading to content', () => {
      // Step 1: Loading state
      mockIsLoading = true
      mockExploreData = undefined
      const { unmount } = renderAppList()

      expect(screen.getByRole('status'))!.toBeInTheDocument()

      // Step 2: Data loads
      mockIsLoading = false
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      unmount()
      renderAppList()

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByText('Alpha'))!.toBeInTheDocument()
    })
  })

  describe('Permission-Based Behavior', () => {
    it('should not make app cards clickable when user has no edit permission', () => {
      renderAppList(false)

      expect(screen.queryByRole('button', { name: 'Writer Bot' })).not.toBeInTheDocument()
    })

    it('should make app cards clickable when user has edit permission', () => {
      renderAppList(true)

      expect(screen.getByRole('button', { name: 'Writer Bot' })).toBeInTheDocument()
    })
  })
})
