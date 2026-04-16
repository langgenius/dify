import type { App } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from '@/app/components/base/ui/toast'
import useAccessControlStore from '@/context/access-control-store'
import { AccessMode } from '@/models/access-control'
import AccessControl from '../index'

const mockMutateAsync = vi.fn()
const mockUseUpdateAccessMode = vi.fn(() => ({
  isPending: false,
  mutateAsync: mockMutateAsync,
}))
const mockUseAppWhiteListSubjects = vi.fn()
const mockUseSearchForWhiteListCandidates = vi.fn()
let mockWebappAuth = {
  enabled: true,
  allow_sso: true,
  allow_email_password_login: false,
  allow_email_code_login: false,
}

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { webapp_auth: typeof mockWebappAuth } }) => unknown) => selector({
    systemFeatures: {
      webapp_auth: mockWebappAuth,
    },
  }),
}))

vi.mock('@/service/access-control', () => ({
  useAppWhiteListSubjects: (...args: unknown[]) => mockUseAppWhiteListSubjects(...args),
  useSearchForWhiteListCandidates: (...args: unknown[]) => mockUseSearchForWhiteListCandidates(...args),
  useUpdateAccessMode: () => mockUseUpdateAccessMode(),
}))

describe('AccessControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWebappAuth = {
      enabled: true,
      allow_sso: true,
      allow_email_password_login: false,
      allow_email_code_login: false,
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

    render(
      <AccessControl
        app={app}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    )

    await waitFor(() => {
      expect(useAccessControlStore.getState().appId).toBe(app.id)
      expect(useAccessControlStore.getState().currentMenu).toBe(AccessMode.PUBLIC)
    })

    fireEvent.click(screen.getByText('common.operation.confirm'))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId: app.id,
        accessMode: AccessMode.PUBLIC,
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
})
