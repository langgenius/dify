import type { ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessMode } from '@/models/access-control'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { EnvironmentAccessControl } from '../deployed-environment-access-points/environment-access-control'

const mocks = vi.hoisted(() => ({
  getSubjects: vi.fn(),
  updateAccessMode: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appDeploy: {
        accessService: {
          getEnvironmentSite: {
            queryOptions: ({
              input,
            }: {
              input: { params: { app_id: string; environment_id: string } }
            }) => ({
              queryKey: ['environment-site', input.params.app_id, input.params.environment_id],
            }),
          },
          getEnvironmentWebAppSubjects: {
            queryOptions: ({
              input,
            }: {
              input: { params: { app_id: string; environment_id: string } }
            }) => ({
              queryKey: ['environment-subjects', input.params.app_id, input.params.environment_id],
              queryFn: () => mocks.getSubjects(input),
            }),
          },
          updateEnvironmentWebAppAccessMode: {
            mutationOptions: (options = {}) => ({
              mutationFn: mocks.updateAccessMode,
              ...options,
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features'],
    queryFn: vi.fn(),
  }),
}))

vi.mock('@/service/access-control', () => ({
  useSearchForWhiteListCandidates: () => ({
    isLoading: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    data: { pages: [] },
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

function renderAccessControl(ui: ReactElement) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['system-features'], {
    webapp_auth: {
      enabled: true,
      allow_sso: true,
      allow_email_password_login: false,
      allow_email_code_login: false,
      allow_public_access: true,
    },
  })

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('EnvironmentAccessControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSubjects.mockResolvedValue({
      subjects: [
        {
          account_data: {
            email: 'ada@example.com',
            id: 'account-1',
            name: 'Ada',
          },
          subject_id: 'account-1',
          subject_type: 'account',
        },
      ],
    })
    mocks.updateAccessMode.mockResolvedValue({
      access_mode: 'private',
      enabled: true,
    })
  })

  it('should submit only subjects loaded from the environment endpoint', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderAccessControl(
      <EnvironmentAccessControl
        appId="app-1"
        environmentId="staging"
        accessMode={AccessMode.SPECIFIC_GROUPS_MEMBERS}
        canManage
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(await screen.findByText('Ada')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(mocks.updateAccessMode.mock.calls[0]?.[0]).toEqual({
        params: {
          app_id: 'app-1',
          environment_id: 'staging',
        },
        body: {
          access_mode: 'private',
          subjects: [
            {
              subject_id: 'account-1',
              subject_type: 'account',
            },
          ],
        },
      })
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  it('should allow authenticated external users to access the environment Web app', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderAccessControl(
      <EnvironmentAccessControl
        appId="app-1"
        environmentId="staging"
        accessMode={AccessMode.ORGANIZATION}
        canManage
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    await user.click(
      screen.getByRole('radio', {
        name: 'app.accessControlDialog.accessItems.external',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(mocks.updateAccessMode.mock.calls[0]?.[0]).toEqual({
        params: {
          app_id: 'app-1',
          environment_id: 'staging',
        },
        body: {
          access_mode: AccessMode.EXTERNAL_MEMBERS,
        },
      })
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  it('should keep confirmation disabled when the environment subjects query fails', async () => {
    const user = userEvent.setup()
    mocks.getSubjects.mockRejectedValue(new Error('subjects unavailable'))

    renderAccessControl(
      <EnvironmentAccessControl
        appId="app-1"
        environmentId="staging"
        accessMode={AccessMode.SPECIFIC_GROUPS_MEMBERS}
        canManage
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('common.dynamicSelect.error')
    const confirmButton = screen.getByRole('button', { name: 'common.operation.confirm' })
    expect(confirmButton).toBeDisabled()

    await user.click(confirmButton)
    expect(mocks.updateAccessMode).not.toHaveBeenCalled()
  })
})
