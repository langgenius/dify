import type { Getter } from 'jotai/vanilla'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScopeProvider } from 'jotai-scope'
import { DeleteDeploymentDialog } from '../delete-dialog'
import {
  deleteDeploymentDialogOpenAtom,
  deploymentActionAppInstanceIdAtom,
} from '../state'

type QueryOptions = {
  input?: unknown
  queryKey?: readonly unknown[]
}

type QueryResult = {
  data?: unknown
}

const mockQueryResults = vi.hoisted(() => ({
  current: new Map<string, QueryResult>(),
}))

const useQueryMock = vi.hoisted(() =>
  vi.fn((options: QueryOptions) => {
    const queryName = String(options.queryKey?.[0] ?? 'unknown')
    const queryResult = mockQueryResults.current.get(queryName)

    return {
      ...options,
      data: queryResult?.data,
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: Boolean(queryResult?.data),
    }
  }),
)

const deleteMutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

const useMutationMock = vi.hoisted(() =>
  vi.fn(() => ({
    isPending: deleteMutationMock.isPending,
    mutate: deleteMutationMock.mutate,
  })),
)

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
}))

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('jotai-tanstack-query', async () => {
  const { atom } = await import('jotai')

  return {
    atomWithQuery: (createOptions: (get: Getter) => QueryOptions) => atom((get) => {
      return useQueryMock(createOptions(get))
    }),
  }
})

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMock,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appInstanceService: {
        getAppInstance: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['getAppInstance', options.input],
          }),
        },
        deleteAppInstance: {
          mutationOptions: () => ({ mutationKey: ['deleteAppInstance'] }),
        },
      },
    },
  },
}))

function setAppInstance() {
  mockQueryResults.current.set('getAppInstance', {
    data: {
      appInstance: {
        id: 'app-instance-1',
        displayName: 'Deployment 1',
      },
    },
  })
}

function renderDialog({
  open = true,
}: {
  open?: boolean
} = {}) {
  render(
    <ScopeProvider
      atoms={[
        [deploymentActionAppInstanceIdAtom, 'app-instance-1'],
        [deleteDeploymentDialogOpenAtom, open],
      ]}
      name="DeleteDeploymentDialogTest"
    >
      <DeleteDeploymentDialog />
    </ScopeProvider>,
  )
}

describe('DeleteDeploymentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryResults.current.clear()
    deleteMutationMock.isPending = false
    setAppInstance()
  })

  describe('Delete action', () => {
    it('should not mount the query or delete mutation before the dialog is opened', () => {
      renderDialog({ open: false })

      expect(useQueryMock).not.toHaveBeenCalled()
      expect(useMutationMock).not.toHaveBeenCalled()
    })

    it('should delete the deployment through the component mutation', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByRole('button', { name: 'deployments.settings.delete' }))

      expect(deleteMutationMock.mutate).toHaveBeenCalledWith({
        params: {
          appInstanceId: 'app-instance-1',
        },
      }, expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
        onSettled: expect.any(Function),
      }))
    })
  })
})
