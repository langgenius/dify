import type { MockedFunction } from 'vitest'
import type { SystemFeatures } from '@/types/feature'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useLocale } from '@/context/i18n'
import { useSendMail } from '@/service/use-common'
import { defaultSystemFeatures } from '@/types/feature'
import Form from './input-mail'

const mockSubmitMail = vi.fn()
const mockOnSuccess = vi.fn()

type SystemFeaturesOverrides = Partial<Omit<SystemFeatures, 'branding'>> & {
  branding?: Partial<SystemFeatures['branding']>
}

const buildSystemFeatures = (overrides: SystemFeaturesOverrides = {}): SystemFeatures => ({
  ...defaultSystemFeatures,
  ...overrides,
  branding: {
    ...defaultSystemFeatures.branding,
    ...overrides.branding,
  },
})

vi.mock('next/link', () => ({
  default: ({ children, href, className, target, rel }: { children: React.ReactNode, href: string, className?: string, target?: string, rel?: string }) => (
    <a href={href} className={className} target={target} rel={rel}>
      {children}
    </a>
  ),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useSendMail: vi.fn(),
}))

type UseSendMailResult = ReturnType<typeof useSendMail>

const mockUseGlobalPublicStore = useGlobalPublicStore as unknown as MockedFunction<typeof useGlobalPublicStore>
const mockUseLocale = useLocale as unknown as MockedFunction<typeof useLocale>
const mockUseSendMail = useSendMail as unknown as MockedFunction<typeof useSendMail>

const renderForm = ({
  brandingEnabled = false,
  isPending = false,
}: {
  brandingEnabled?: boolean
  isPending?: boolean
} = {}) => {
  mockUseGlobalPublicStore.mockReturnValue({
    systemFeatures: buildSystemFeatures({
      branding: { enabled: brandingEnabled },
    }),
  })
  mockUseLocale.mockReturnValue('en-US')
  mockUseSendMail.mockReturnValue({
    mutateAsync: mockSubmitMail,
    isPending,
  } as unknown as UseSendMailResult)
  return render(<Form onSuccess={mockOnSuccess} />)
}

describe('InputMail Form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubmitMail.mockResolvedValue({ result: 'success', data: 'token' })
  })

  // Rendering baseline UI elements.
  describe('Rendering', () => {
    it('should render email input and submit button', () => {
      renderForm()

      expect(screen.getByLabelText('login.email')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'login.signup.verifyMail' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'login.signup.signIn' })).toBeInTheDocument()
    })
  })

  // Prop-driven branding content visibility.
  describe('Props', () => {
    it('should show terms links when branding is disabled', () => {
      renderForm({ brandingEnabled: false })

      expect(screen.getByRole('link', { name: 'login.tos' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'login.pp' })).toBeInTheDocument()
    })

    it('should hide terms links when branding is enabled', () => {
      renderForm({ brandingEnabled: true })

      expect(screen.queryByRole('link', { name: 'login.tos' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'login.pp' })).not.toBeInTheDocument()
    })
  })

  // Submission flow and mutation integration.
  describe('User Interactions', () => {
    it('should submit email and call onSuccess when mutation succeeds', async () => {
      renderForm()
      const input = screen.getByLabelText('login.email')
      const button = screen.getByRole('button', { name: 'login.signup.verifyMail' })

      fireEvent.change(input, { target: { value: 'test@example.com' } })
      fireEvent.click(button)

      expect(mockSubmitMail).toHaveBeenCalledWith({
        email: 'test@example.com',
        language: 'en-US',
      })

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalledWith('test@example.com', 'token')
      })
    })
  })

  // Validation and failure paths.
  describe('Edge Cases', () => {
    it('should block submission when email is invalid', () => {
      const { container } = renderForm()
      const form = container.querySelector('form')
      const input = screen.getByLabelText('login.email')

      fireEvent.change(input, { target: { value: 'invalid-email' } })
      expect(form).not.toBeNull()
      fireEvent.submit(form as HTMLFormElement)

      expect(mockSubmitMail).not.toHaveBeenCalled()
      expect(mockOnSuccess).not.toHaveBeenCalled()
    })

    it('should not call onSuccess when mutation does not succeed', async () => {
      mockSubmitMail.mockResolvedValue({ result: 'failed', data: 'token' })
      renderForm()
      const input = screen.getByLabelText('login.email')
      const button = screen.getByRole('button', { name: 'login.signup.verifyMail' })

      fireEvent.change(input, { target: { value: 'test@example.com' } })
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockSubmitMail).toHaveBeenCalled()
      })
      expect(mockOnSuccess).not.toHaveBeenCalled()
    })
  })
})
