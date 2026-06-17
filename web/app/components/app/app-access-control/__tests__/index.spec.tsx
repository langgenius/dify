import type { ReactElement } from 'react'
import type { App } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { AccessMode } from '@/models/access-control'
import { AccessControl } from '../index'

let mockWebappAuth = {
  enabled: true,
  allow_sso: true,
  allow_email_password_login: false,
  allow_email_code_login: false,
}

const render = (ui: ReactElement) => renderWithSystemFeatures(ui, {
  systemFeatures: { webapp_auth: mockWebappAuth },
})

const mockMutate = vi.fn()
const mockUseMutation = vi.hoisted(() => vi.fn())
const mockUseAppWhiteListSubjects = vi.fn()
const mockUseSearchForWhiteListCandidates = vi.fn()

vi.mock('@/service/access-control', () => ({
  useAppWhiteListSubjects: (...args: unknown[]) => mockUseAppWhiteListSubjects(...args),
  useSearchForWhiteListCandidates: (...args: unknown[]) => mockUseSearchForWhiteListCandidates(...args),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useMutation: (...args: unknown[]) => mockUseMutation(...args),
  }
})

describe('AccessControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWebappAuth = {
      enabled: true,
      allow_sso: true,
      allow_email_password_login: false,
      allow_email_code_login: false,
    }
    mockMutate.mockImplementation((_: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    })
    mockUseMutation.mockReturnValue({
      isPending: false,
      mutate: mockMutate,
    })
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

    fireEvent.click(screen.getByText('common.operation.confirm'))

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        {
          body: {
            appId: app.id,
            accessMode: AccessMode.PUBLIC,
          },
        },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      )
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

  it('should prevent confirming specific access before subjects are loaded', () => {
    mockUseAppWhiteListSubjects.mockReturnValue({
      isPending: true,
      data: undefined,
    })

    render(
      <AccessControl
        app={{ id: 'app-id-3', access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS } as App}
        onClose={vi.fn()}
      />,
    )

    const confirmButton = screen.getByRole('button', { name: 'common.operation.confirm' })
    const organizationOption = screen.getByRole('radio', {
      name: 'app.accessControlDialog.accessItems.organization',
    })

    expect(confirmButton).toBeDisabled()
    expect(organizationOption).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(confirmButton)

    expect(mockMutate).not.toHaveBeenCalled()
  })
})
