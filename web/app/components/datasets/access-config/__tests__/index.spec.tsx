import type { AccessRulesEditorProps } from '@/app/components/access-rules-editor'
import { screen } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import {
  useDatasetAccessRules,
  useDatasetUserAccessSettings,
} from '@/service/access-control/use-dataset-access-config'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetAccessConfigPage from '../index'

const mockDatasetAccessRules = vi.hoisted(() => ({
  items: [] as AccessRulesEditorProps['rules'],
  isLoading: false,
}))

const mockDatasetUserAccessSettings = vi.hoisted(() => ({
  data: [] as NonNullable<AccessRulesEditorProps['userAccessSettings']>,
  scope: 'specific' as AccessRulesEditorProps['openScope'],
  isLoading: false,
}))

const mockDatasetDetail = vi.hoisted(() => ({
  dataset: undefined as { maintainer?: string | null; permission_keys?: string[] } | undefined,
}))

const mockAppContextState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}))

let mockIsRbacEnabled = true

const render = (ui: Parameters<typeof renderWithSystemFeatures>[0]) =>
  renderWithSystemFeatures(ui, {
    systemFeatures: {
      rbac_enabled: mockIsRbacEnabled,
    },
  })

const mockAccessRulesEditor = vi.hoisted(() => ({
  props: null as AccessRulesEditorProps | null,
}))

const mockMutations = vi.hoisted(() => ({
  updateOpenScope: vi.fn(),
  updateUserAccessSettings: vi.fn(),
  removeMemberBindings: vi.fn(),
}))

vi.mock('@/service/access-control/use-dataset-access-config', () => ({
  useDatasetAccessRules: vi.fn(() => ({
    data: { items: mockDatasetAccessRules.items },
    isLoading: mockDatasetAccessRules.isLoading,
  })),
  useDatasetUserAccessSettings: vi.fn(() => ({
    data: mockDatasetUserAccessSettings.scope
      ? { data: mockDatasetUserAccessSettings.data, scope: mockDatasetUserAccessSettings.scope }
      : undefined,
    isLoading: mockDatasetUserAccessSettings.isLoading,
  })),
  useUpdateDatasetOpenScope: vi.fn(() => ({
    mutate: mockMutations.updateOpenScope,
    isPending: false,
  })),
  useUpdateDatasetUserAccessSettings: vi.fn(() => ({
    mutate: mockMutations.updateUserAccessSettings,
  })),
  useRemoveDatasetAccessPolicyMemberBindings: vi.fn(() => ({
    mutate: mockMutations.removeMemberBindings,
  })),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: vi.fn(
    (
      selector: (state: {
        dataset?: { maintainer?: string | null; permission_keys?: string[] }
      }) => unknown,
    ) => {
      return selector({ dataset: mockDatasetDetail.dataset })
    },
  ),
}))

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(
    importOriginal,
    () => mockAppContextState,
    () => ({
      isRbacEnabled: mockIsRbacEnabled,
    }),
  )
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(
    importOriginal,
    () => mockAppContextState,
    () => ({
      isRbacEnabled: mockIsRbacEnabled,
    }),
  )
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(
    importOriginal,
    () => mockAppContextState,
    () => ({
      isRbacEnabled: mockIsRbacEnabled,
    }),
  )
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(
    importOriginal,
    () => mockAppContextState,
    () => ({
      isRbacEnabled: mockIsRbacEnabled,
    }),
  )
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(
    importOriginal,
    () => mockAppContextState,
    () => ({
      isRbacEnabled: mockIsRbacEnabled,
    }),
  )
})

vi.mock('@/app/components/access-rules-editor', () => ({
  default: (props: AccessRulesEditorProps) => {
    mockAccessRulesEditor.props = props
    return <div data-testid="access-rules-editor" />
  },
}))

vi.mock('jotai', async (importOriginal) => {
  const { createDatasetAccessJotaiMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessJotaiMock(importOriginal)
})

describe('DatasetAccessConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetAccessRules.items = []
    mockDatasetAccessRules.isLoading = false
    mockDatasetUserAccessSettings.data = []
    mockDatasetUserAccessSettings.scope = 'specific'
    mockDatasetUserAccessSettings.isLoading = false
    mockDatasetDetail.dataset = {
      maintainer: 'maintainer-1',
      permission_keys: [DatasetACLPermission.AccessConfig],
    }
    mockAppContextState.userProfile = { id: 'user-1' }
    mockAppContextState.workspacePermissionKeys = []
    mockIsRbacEnabled = true
    mockAccessRulesEditor.props = null
  })

  // Rendering wires dataset access rules into the shared editor.
  describe('Rendering', () => {
    it('should render access config title and pass dataset rules to the editor', () => {
      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(
        screen.getByRole('heading', { name: 'common.settings.resourceAccess' }),
      ).toBeInTheDocument()
      expect(screen.getByText('permission.accessRule.datasetDescription')).toBeInTheDocument()
      expect(screen.getByTestId('access-rules-editor')).toBeInTheDocument()
      expect(mockAccessRulesEditor.props?.className).toBe('w-full max-w-200')
      expect(mockAccessRulesEditor.props?.rules).toEqual([])
      expect(mockAccessRulesEditor.props?.userAccessSettings).toEqual([])
      expect(mockAccessRulesEditor.props?.openScope).toBe('specific')
    })

    it('should not pass open scope before user access settings finish loading', () => {
      mockDatasetUserAccessSettings.scope = undefined
      mockDatasetUserAccessSettings.isLoading = true

      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(mockAccessRulesEditor.props?.openScope).toBeUndefined()
    })

    it('should pass the user access settings open scope to the editor', () => {
      mockDatasetUserAccessSettings.scope = 'all'

      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(mockAccessRulesEditor.props?.openScope).toBe('all')
    })

    it('should pass access rule loading state to the editor', () => {
      mockDatasetAccessRules.isLoading = true
      mockDatasetUserAccessSettings.isLoading = true

      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(mockAccessRulesEditor.props?.isLoadingRules).toBe(true)
      expect(mockAccessRulesEditor.props?.isLoadingUserAccessSettings).toBe(true)
      expect(mockAccessRulesEditor.props?.isUpdatingOpenScope).toBe(true)
    })

    it('should pass the dataset maintainer id from dataset detail to the editor', () => {
      mockDatasetDetail.dataset = {
        maintainer: 'account-1',
        permission_keys: [DatasetACLPermission.AccessConfig],
      }

      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(mockAccessRulesEditor.props?.maintainerId).toBe('account-1')
    })

    it('should disable access config queries and hide the editor when access config permission is missing', () => {
      mockDatasetDetail.dataset = {
        maintainer: 'account-1',
        permission_keys: [],
      }

      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(screen.queryByTestId('access-rules-editor')).not.toBeInTheDocument()
      expect(vi.mocked(useDatasetAccessRules)).toHaveBeenCalledWith(
        'dataset-1',
        expect.any(String),
        { enabled: false },
      )
      expect(vi.mocked(useDatasetUserAccessSettings)).toHaveBeenCalledWith(
        'dataset-1',
        expect.any(String),
        { enabled: false },
      )
    })

    it('should disable access config queries and hide the editor when RBAC is disabled', () => {
      mockIsRbacEnabled = false

      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(screen.queryByTestId('access-rules-editor')).not.toBeInTheDocument()
      expect(vi.mocked(useDatasetAccessRules)).toHaveBeenCalledWith(
        'dataset-1',
        expect.any(String),
        { enabled: false },
      )
      expect(vi.mocked(useDatasetUserAccessSettings)).toHaveBeenCalledWith(
        'dataset-1',
        expect.any(String),
        { enabled: false },
      )
    })

    it('should wire open scope and user policy updates', () => {
      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      mockAccessRulesEditor.props?.onOpenScopeChange?.('all')
      expect(mockMutations.updateOpenScope).toHaveBeenCalledWith(
        'all',
        expect.objectContaining({
          onError: expect.any(Function),
        }),
      )

      mockAccessRulesEditor.props?.onUserAccessPoliciesChange?.('account-1', ['policy-1'])
      expect(mockMutations.updateUserAccessSettings).toHaveBeenCalledWith(
        {
          accountId: 'account-1',
          accessPolicyIds: ['policy-1'],
        },
        expect.objectContaining({
          onSettled: expect.any(Function),
        }),
      )

      mockAccessRulesEditor.props?.onAddAccessSubject?.('account-2', ['default'])
      expect(mockMutations.updateUserAccessSettings).toHaveBeenCalledWith(
        {
          accountId: 'account-2',
          accessPolicyIds: ['default'],
        },
        expect.objectContaining({
          onSettled: expect.any(Function),
        }),
      )

      mockAccessRulesEditor.props?.onRemoveAccessPolicyMemberBinding?.('account-3', 'policy-3')
      expect(mockMutations.removeMemberBindings).toHaveBeenCalledWith(
        {
          accessPolicyId: 'policy-3',
          accountIds: ['account-3'],
        },
        expect.objectContaining({
          onSettled: expect.any(Function),
        }),
      )
    })
  })
})
