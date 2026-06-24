import type { Getter } from 'jotai/vanilla'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScopeProvider } from 'jotai-scope'
import { EditDeploymentDialog } from '../edit-dialog'
import {
  deploymentActionAppInstanceIdAtom,
  editDeploymentDialogOpenAtom,
} from '../state'

type QueryOptions = {
  input?: unknown
  queryKey?: readonly unknown[]
}

type QueryResult = {
  data?: unknown
  isError?: boolean
  isLoading?: boolean
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
      isError: queryResult?.isError ?? false,
      isFetching: false,
      isLoading: queryResult?.isLoading ?? false,
      isSuccess: Boolean(queryResult?.data),
    }
  }),
)

const updateMutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

const useMutationMock = vi.hoisted(() =>
  vi.fn(() => ({
    isPending: updateMutationMock.isPending,
    mutate: updateMutationMock.mutate,
  })),
)

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
        updateAppInstance: {
          mutationOptions: () => ({ mutationKey: ['updateAppInstance'] }),
        },
        deleteAppInstance: {
          mutationOptions: () => ({ mutationKey: ['deleteAppInstance'] }),
        },
      },
    },
  },
}))

function setAppInstance(overrides: Record<string, unknown> = {}) {
  mockQueryResults.current.set('getAppInstance', {
    data: {
      appInstance: {
        id: 'app-instance-1',
        displayName: 'Deployment 1',
        description: 'Initial description',
        ...overrides,
      },
    },
  })
}

function setAppInstanceLoading() {
  mockQueryResults.current.set('getAppInstance', {
    isLoading: true,
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
        [editDeploymentDialogOpenAtom, open],
      ]}
      name="EditDeploymentDialogTest"
    >
      <EditDeploymentDialog />
    </ScopeProvider>,
  )
}

describe('EditDeploymentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryResults.current.clear()
    updateMutationMock.isPending = false
    setAppInstance()
  })

  describe('Form submission', () => {
    it('should not mount the query or update mutation before the dialog is opened', () => {
      renderDialog({ open: false })

      expect(useQueryMock).not.toHaveBeenCalled()
      expect(useMutationMock).not.toHaveBeenCalled()
    })

    it('should create the update mutation only after the edit form is ready', () => {
      setAppInstanceLoading()

      renderDialog()

      expect(useMutationMock).not.toHaveBeenCalled()
    })

    it('should submit trimmed deployment metadata through the component mutation', async () => {
      const user = userEvent.setup()
      renderDialog()

      const dialog = screen.getByRole('dialog', { name: 'deployments.card.menu.editInfo' })
      await user.clear(within(dialog).getByRole('textbox', { name: 'deployments.settings.name' }))
      await user.type(within(dialog).getByRole('textbox', { name: 'deployments.settings.name' }), ' Deployment 2 ')
      await user.clear(within(dialog).getByRole('textbox', { name: 'deployments.settings.description' }))
      await user.type(within(dialog).getByRole('textbox', { name: 'deployments.settings.description' }), ' Updated description ')
      await user.click(within(dialog).getByRole('button', { name: 'deployments.settings.save' }))

      expect(updateMutationMock.mutate).toHaveBeenCalledWith({
        params: {
          appInstanceId: 'app-instance-1',
        },
        body: {
          appInstanceId: 'app-instance-1',
          displayName: 'Deployment 2',
          description: 'Updated description',
        },
      }, expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }))
    })
  })
})
