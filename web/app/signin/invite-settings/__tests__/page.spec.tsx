import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import InviteSettingsPage from '../page'

const mockReplace = vi.fn()
const mockRefetch = vi.fn()
const mockActivateMember = vi.fn()
const mockSetLocaleOnClient = vi.fn()
const mockResolvePostLoginRedirect = vi.fn()

let mockInviteToken = 'invite-token'
let mockCheckRes: {
  is_valid: boolean
  data: {
    workspace_name: string
    email: string
    workspace_id: string
  }
} | undefined

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => ({
    get: (key: string) => key === 'invite_token' ? mockInviteToken : null,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: (selector: (state: { systemFeatures: { branding: { enabled: boolean } } }) => unknown) =>
    selector({
      systemFeatures: {
        branding: {
          enabled: true,
        },
      },
    }),
}))

vi.mock('@/service/use-common', () => ({
  useInvitationCheck: () => ({
    data: mockCheckRes,
    refetch: mockRefetch,
  }),
}))

vi.mock('@/service/common', () => ({
  activateMember: (...args: unknown[]) => mockActivateMember(...args),
}))

vi.mock('@/i18n-config', () => ({
  setLocaleOnClient: (...args: unknown[]) => mockSetLocaleOnClient(...args),
}))

vi.mock('../../utils/post-login-redirect', () => ({
  resolvePostLoginRedirect: () => mockResolvePostLoginRedirect(),
}))

describe('InviteSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInviteToken = 'invite-token'
    mockCheckRes = undefined
    mockActivateMember.mockResolvedValue({ result: 'success' })
    mockSetLocaleOnClient.mockResolvedValue(undefined)
    mockResolvePostLoginRedirect.mockReturnValue('/apps')
  })

  describe('Activation Gating', () => {
    it('should not activate when invitation validation is still pending and Enter is pressed', () => {
      render(<InviteSettingsPage />)

      const nameInput = screen.getByLabelText('login.name')
      fireEvent.change(nameInput, { target: { value: 'Alice' } })
      fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter', charCode: 13 })

      expect(mockActivateMember).not.toHaveBeenCalled()
    })

    it('should activate when invitation validation has succeeded', async () => {
      mockCheckRes = {
        is_valid: true,
        data: {
          workspace_name: 'Demo Workspace',
          email: 'alice@example.com',
          workspace_id: 'workspace-1',
        },
      }

      render(<InviteSettingsPage />)

      const nameInput = screen.getByLabelText('login.name')
      fireEvent.change(nameInput, { target: { value: 'Alice' } })
      fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter', charCode: 13 })

      await waitFor(() => {
        expect(mockActivateMember).toHaveBeenCalledWith({
          url: '/activate',
          body: {
            token: 'invite-token',
            name: 'Alice',
            interface_language: 'en-US',
            timezone: expect.any(String),
          },
        })
      })
      expect(mockSetLocaleOnClient).toHaveBeenCalledWith('en-US', false)
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
  })
})
