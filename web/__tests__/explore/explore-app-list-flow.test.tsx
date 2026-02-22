/**
 * Integration test: Explore App List Flow
 *
 * Tests the end-to-end user flow of browsing, filtering, searching,
 * and adding apps to workspace from the explore page.
 */
import type { Mock } from 'vitest'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { App } from '@/models/explore'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AppList from '@/app/components/explore/app-list'
import { useAppContext } from '@/context/app-context'
import { fetchAppDetail } from '@/service/explore'
import { useMembers } from '@/service/use-common'
import { AppModeEnum } from '@/types/app'

const allCategoriesEn = 'explore.apps.allCategories:{"lng":"en"}'
let mockTabValue = allCategoriesEn
const mockSetTab = vi.fn()
let mockExploreData: { categories: string[], allList: App[] } | undefined
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
  useExploreAppList: () => ({
    data: mockExploreData,
    isLoading: mockIsLoading,
    isError: false,
  }),
}))

vi.mock('@/service/explore', () => ({
  fetchAppDetail: vi.fn(),
  fetchAppList: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

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
    if (!props.show)
      return null
    return (
      <div data-testid="create-app-modal">
        <button
          data-testid="confirm-create"
          onClick={() => props.onConfirm({
            name: 'New App',
            icon_type: 'emoji',
            icon: '🤖',
            icon_background: '#fff',
            description: 'desc',
          })}
        >
          confirm
        </button>
        <button data-testid="hide-create" onClick={props.onHide}>hide</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/app/create-from-dsl-modal/dsl-confirm-modal', () => ({
  default: ({ onConfirm, onCancel }: { onConfirm: () => void, onCancel: () => void }) => (
    <div data-testid="dsl-confirm-modal">
      <button data-testid="dsl-confirm" onClick={onConfirm}>confirm</button>
      <button data-testid="dsl-cancel" onClick={onCancel}>cancel</button>
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
  category: overrides.category ?? 'Writing',
  position: overrides.position ?? 1,
  is_listed: overrides.is_listed ?? true,
  install_count: overrides.install_count ?? 0,
  installed: overrides.installed ?? false,
  editable: overrides.editable ?? false,
  is_agent: overrides.is_agent ?? false,
})

const mockMemberRole = (hasEditPermission: boolean) => {
  ;(useAppContext as Mock).mockReturnValue({
    userProfile: { id: 'user-1' },
  })
  ;(useMembers as Mock).mockReturnValue({
    data: {
      accounts: [{ id: 'user-1', role: hasEditPermission ? 'admin' : 'normal' }],
    },
  })
}

const renderAppList = (hasEditPermission = true, onSuccess?: () => void) => {
  mockMemberRole(hasEditPermission)
  return render(<AppList onSuccess={onSuccess} />)
}

const appListElement = (hasEditPermission = true, onSuccess?: () => void) => {
  mockMemberRole(hasEditPermission)
  return <AppList onSuccess={onSuccess} />
}

describe('Explore App List Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTabValue = allCategoriesEn
    mockIsLoading = false
    mockExploreData = {
      categories: ['Writing', 'Translate', 'Programming'],
      allList: [
        createApp({ app_id: 'app-1', app: { ...createApp().app, name: 'Writer Bot' }, category: 'Writing' }),
        createApp({ app_id: 'app-2', app: { ...createApp().app, id: 'app-id-2', name: 'Translator' }, category: 'Translate' }),
        createApp({ app_id: 'app-3', app: { ...createApp().app, id: 'app-id-3', name: 'Code Helper' }, category: 'Programming' }),
      ],
    }
  })

  describe('Browse and Filter Flow', () => {
    it('should display all apps when no category filter is applied', () => {
      renderAppList()

      expect(screen.getByText('Writer Bot')).toBeInTheDocument()
      expect(screen.getByText('Translator')).toBeInTheDocument()
      expect(screen.getByText('Code Helper')).toBeInTheDocument()
    })

    it('should filter apps by selected category', () => {
      mockTabValue = 'Writing'
      renderAppList()

      expect(screen.getByText('Writer Bot')).toBeInTheDocument()
      expect(screen.queryByText('Translator')).not.toBeInTheDocument()
      expect(screen.queryByText('Code Helper')).not.toBeInTheDocument()
    })

    it('should filter apps by search keyword', async () => {
      renderAppList()

      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'trans' } })

      await waitFor(() => {
        expect(screen.getByText('Translator')).toBeInTheDocument()
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
      mockHandleImportDSL.mockImplementation(async (_payload: unknown, options: { onSuccess?: () => void, onPending?: () => void }) => {
        options.onPending?.()
      })
      mockHandleImportDSLConfirm.mockImplementation(async (options: { onSuccess?: () => void }) => {
        options.onSuccess?.()
      })

      renderAppList(true, onSuccess)

      // Step 2: Click add to workspace button - opens create modal
      fireEvent.click(screen.getAllByText('explore.appCard.addToWorkspace')[0])

      // Step 3: Confirm creation in modal
      fireEvent.click(await screen.findByTestId('confirm-create'))

      // Step 4: API fetches app detail
      await waitFor(() => {
        expect(fetchAppDetail).toHaveBeenCalledWith('app-id')
      })

      // Step 5: DSL import triggers pending confirmation
      expect(mockHandleImportDSL).toHaveBeenCalledTimes(1)

      // Step 6: DSL confirm modal appears and user confirms
      expect(await screen.findByTestId('dsl-confirm-modal')).toBeInTheDocument()
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
      const { unmount } = render(appListElement())

      expect(screen.getByRole('status')).toBeInTheDocument()

      // Step 2: Data loads
      mockIsLoading = false
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      unmount()
      renderAppList()

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByText('Alpha')).toBeInTheDocument()
    })
  })

  describe('Permission-Based Behavior', () => {
    it('should hide add-to-workspace button when user has no edit permission', () => {
      renderAppList(false)

      expect(screen.queryByText('explore.appCard.addToWorkspace')).not.toBeInTheDocument()
    })

    it('should show add-to-workspace button when user has edit permission', () => {
      renderAppList(true)

      expect(screen.getAllByText('explore.appCard.addToWorkspace').length).toBeGreaterThan(0)
    })
  })
})
