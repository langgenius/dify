import type { ReactElement } from 'react'
import type { App } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessMode } from '@/models/access-control'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import AccessControl from '../index'

let mockWebappAuth = {
  enabled: true,
  allow_sso: true,
  allow_email_password_login: false,
  allow_email_code_login: false,
  allow_public_access: true,
}

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: { webapp_auth: mockWebappAuth },
  })

const { mockMutateAsync } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
}))
const mockUseAppWhiteListSubjects = vi.fn()
const mockUseSearchForWhiteListCandidates = vi.fn()

vi.mock('@/service/access-control', () => ({
  useAppWhiteListSubjects: (...args: unknown[]) => mockUseAppWhiteListSubjects(...args),
  useSearchForWhiteListCandidates: (...args: unknown[]) =>
    mockUseSearchForWhiteListCandidates(...args),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    systemFeatures: {
      get: {
        queryKey: () => ['system-features'],
        queryOptions: (options: Record<string, unknown> = {}) => ({
          queryKey: ['system-features'],
          ...options,
        }),
      },
    },
    enterprise: {
      webAppAuth: {
        updateWebAppWhitelistSubjects: {
          mutationOptions: () => ({ mutationFn: mockMutateAsync }),
        },
      },
    },
  },
}))

describe('AccessControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWebappAuth = {
      enabled: true,
      allow_sso: true,
      allow_email_password_login: false,
      allow_email_code_login: false,
      allow_public_access: true,
    }
    mockMutateAsync.mockResolvedValue(undefined)
    mockUseAppWhiteListSubjects.mockReturnValue({
      isPending: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        groups: [],
        members: [],
      },
    })
    mockUseSearchForWhiteListCandidates.mockReturnValue({
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      data: { pages: [] },
    })
  })

  it('should initialize the mode from the app and update it on confirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const toastSpy = vi.spyOn(toast, 'success').mockReturnValue('toast-success')
    const app = {
      id: 'app-id-1',
      access_mode: AccessMode.PUBLIC,
    } as App

    render(<AccessControl app={app} onClose={vi.fn()} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(mockMutateAsync.mock.calls[0]?.[0]).toEqual({
        body: {
          appId: app.id,
          accessMode: AccessMode.PUBLIC,
        },
      })
      expect(toastSpy).toHaveBeenCalledWith('app.accessControlDialog.updateSuccess')
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  it('should submit the successfully loaded specific subjects', async () => {
    const user = userEvent.setup()
    mockUseAppWhiteListSubjects.mockReturnValue({
      isPending: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        groups: [{ id: 'group-1', name: 'Group', groupSize: 2 }],
        members: [
          {
            id: 'member-1',
            name: 'Member',
            email: 'member@example.com',
            avatar: '',
            avatarUrl: '',
          },
        ],
      },
    })

    render(
      <AccessControl
        app={{ id: 'app-id-2', access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS }}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(mockMutateAsync.mock.calls[0]?.[0]).toEqual({
        body: {
          appId: 'app-id-2',
          accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
          subjects: [
            { subjectId: 'group-1', subjectType: 'group' },
            { subjectId: 'member-1', subjectType: 'account' },
          ],
        },
      })
    })
  })

  it('should disable confirmation and preserve the error when specific subjects fail to load', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockUseAppWhiteListSubjects.mockReturnValue({
      isPending: false,
      isFetching: false,
      isError: true,
      refetch,
      data: undefined,
    })

    render(
      <AccessControl
        app={{ id: 'app-id-3', access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('common.dynamicSelect.error')
    expect(screen.queryByText('app.accessControlDialog.noGroupsOrMembers')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
    expect(mockMutateAsync).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('should show the external-members option when the SSO tip is visible', () => {
    mockWebappAuth = {
      enabled: false,
      allow_sso: false,
      allow_email_password_login: false,
      allow_email_code_login: false,
      allow_public_access: true,
    }

    render(
      <AccessControl
        app={{ id: 'app-id-4', access_mode: AccessMode.PUBLIC } as App}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('app.accessControlDialog.accessItems.external')).toBeInTheDocument()
    expect(screen.getByText('app.accessControlDialog.accessItems.anyone')).toBeInTheDocument()
  })

  it('should preserve an unfinished selection when the parent rerenders', async () => {
    const user = userEvent.setup()
    const app = { id: 'app-id-5', access_mode: AccessMode.PUBLIC } as App
    const { rerender } = render(<AccessControl app={app} onClose={vi.fn()} />)

    const organization = screen.getByRole('radio', {
      name: 'app.accessControlDialog.accessItems.organization',
    })
    await user.click(organization)
    expect(organization).toBeChecked()

    rerender(<AccessControl app={{ ...app }} onClose={vi.fn()} />)
    expect(organization).toBeChecked()
  })

  it('should disable public access and explain why when it is disabled by the system', () => {
    mockWebappAuth = {
      enabled: true,
      allow_sso: true,
      allow_email_password_login: false,
      allow_email_code_login: false,
      allow_public_access: false,
    }

    render(
      <AccessControl
        app={{ id: 'app-id-6', access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS } as App}
        onClose={vi.fn()}
      />,
    )

    const publicOption = screen.getByRole('radio', {
      name: /app\.accessControlDialog\.accessItems\.anyone/,
    })
    expect(publicOption).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByLabelText('app.accessControlDialog.webAppPublicAccessDisabledTip'),
    ).toBeInTheDocument()
  })
})
