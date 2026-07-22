import type { ReactElement } from 'react'
import type { App } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useAccessControlStore from '@/context/access-control-store'
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
    systemFeatures: { get: { queryKey: () => ['system-features'] } },
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
    useAccessControlStore.setState({
      appId: '',
      specificGroups: [],
      specificMembers: [],
      currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS,
      selectedGroupsForBreadcrumb: [],
    })
    mockMutateAsync.mockResolvedValue(undefined)
    mockUseAppWhiteListSubjects.mockReturnValue({
      isPending: false,
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

  it('should initialize menu from the app and update access mode on confirm', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const toastSpy = vi.spyOn(toast, 'success').mockReturnValue('toast-success')
    const app = {
      id: 'app-id-1',
      access_mode: AccessMode.PUBLIC,
    } as App

    render(<AccessControl app={app} onClose={onClose} onConfirm={onConfirm} />)

    await waitFor(() => {
      expect(useAccessControlStore.getState().appId).toBe(app.id)
      expect(useAccessControlStore.getState().currentMenu).toBe(AccessMode.PUBLIC)
    })

    fireEvent.click(screen.getByText('common.operation.confirm'))

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

  it('should show the external-members option when SSO tip is visible', () => {
    mockWebappAuth = {
      enabled: false,
      allow_sso: false,
      allow_email_password_login: false,
      allow_email_code_login: false,
      allow_public_access: true,
    }

    render(
      <AccessControl
        app={{ id: 'app-id-2', access_mode: AccessMode.PUBLIC } as App}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('app.accessControlDialog.accessItems.external')).toBeInTheDocument()
    expect(screen.getByText('app.accessControlDialog.accessItems.anyone')).toBeInTheDocument()
  })

  it('should preserve an unfinished selection when the parent rerenders', async () => {
    const user = userEvent.setup()
    const app = { id: 'app-id-3', access_mode: AccessMode.PUBLIC } as App
    const { rerender } = render(<AccessControl app={app} onClose={vi.fn()} />)

    const organization = screen.getByRole('radio', {
      name: 'app.accessControlDialog.accessItems.organization',
    })
    await user.click(organization)
    expect(organization).toBeChecked()

    rerender(<AccessControl app={{ ...app }} onClose={vi.fn()} />)

    expect(organization).toBeChecked()
  })

  describe('public access control', () => {
    it('should render the public option enabled without a tooltip when public access is allowed', () => {
      render(
        <AccessControl
          app={{ id: 'app-id-4', access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS } as App}
          onClose={vi.fn()}
        />,
      )

      const publicOption = screen.getByRole('radio', {
        name: /app\.accessControlDialog\.accessItems\.anyone/,
      })
      expect(publicOption).not.toHaveAttribute('data-disabled')
      expect(
        screen.queryByLabelText('app.accessControlDialog.webAppPublicAccessDisabledTip'),
      ).not.toBeInTheDocument()
    })

    it('should render the public option disabled with a tooltip when public access is disabled', () => {
      mockWebappAuth = {
        enabled: true,
        allow_sso: true,
        allow_email_password_login: false,
        allow_email_code_login: false,
        allow_public_access: false,
      }

      render(
        <AccessControl
          app={{ id: 'app-id-5', access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS } as App}
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
})
