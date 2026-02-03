import type { UseMutationOptions, UseMutationResult } from '@tanstack/react-query'
import type { ModalContextState } from '@/context/modal-context'
import { useMutation } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { baseProviderContextValue, useProviderContext } from '@/context/provider-context'
import { getDocDownloadUrl } from '@/service/common'
import { downloadUrl } from '@/utils/download'
import Toast from '../../base/toast'
import Compliance from './compliance'

vi.mock('@/context/provider-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/provider-context')>()
  return {
    ...actual,
    useProviderContext: vi.fn(),
  }
})

vi.mock('@/context/modal-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/modal-context')>()
  return {
    ...actual,
    useModalContext: vi.fn(),
  }
})

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/service/common', () => ({
  getDocDownloadUrl: vi.fn(),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

vi.mock('../../base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

describe('Compliance', () => {
  const mockSetShowPricingModal = vi.fn()
  const mockSetShowAccountSettingModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.sandbox,
      },
    })
    vi.mocked(useModalContext).mockReturnValue({
      setShowPricingModal: mockSetShowPricingModal,
      setShowAccountSettingModal: mockSetShowAccountSettingModal,
    } as unknown as ModalContextState)

    // Default mock for useMutation that just calls the mutationFn
    vi.mocked(useMutation).mockImplementation((options: UseMutationOptions<unknown, unknown, unknown, unknown>) => ({
      mutate: options.mutationFn,
      isPending: false,
    } as unknown as UseMutationResult<unknown, unknown, unknown, unknown>))
  })

  it('renders compliance menu trigger', () => {
    render(<Compliance />)
    expect(screen.getByText('userProfile.compliance')).toBeDefined()
  })

  it('shows SOC2, ISO, GDPR items when opened', () => {
    render(<Compliance />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('compliance.soc2Type1')).toBeDefined()
    expect(screen.getByText('compliance.soc2Type2')).toBeDefined()
    expect(screen.getByText('compliance.iso27001')).toBeDefined()
    expect(screen.getByText('compliance.gdpr')).toBeDefined()
  })

  it('shows Upgrade badge for sandbox plan on restricted docs', () => {
    render(<Compliance />)
    fireEvent.click(screen.getByRole('button'))
    // SOC2 Type I is restricted for sandbox
    expect(screen.getAllByText('upgradeBtn.encourageShort').length).toBeGreaterThan(0)
  })

  it('shows Download button for plan that allows it', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.team,
      },
    })
    render(<Compliance />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getAllByText('operation.download').length).toBeGreaterThan(0)
  })

  it('triggers download mutation successfully', async () => {
    const mockUrl = 'http://example.com/doc.pdf'
    vi.mocked(getDocDownloadUrl).mockResolvedValue({ url: mockUrl })
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.team,
      },
    })

    render(<Compliance />)
    fireEvent.click(screen.getByRole('button'))
    const downloadButtons = screen.getAllByText('operation.download')
    fireEvent.click(downloadButtons[0])

    await waitFor(() => {
      expect(getDocDownloadUrl).toHaveBeenCalled()
      expect(downloadUrl).toHaveBeenCalledWith({ url: mockUrl })
      expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    })
  })

  it('handles download mutation error', async () => {
    vi.mocked(getDocDownloadUrl).mockRejectedValue(new Error('Download failed'))
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.team,
      },
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

    render(<Compliance />)
    fireEvent.click(screen.getByRole('button'))
    const downloadButtons = screen.getAllByText('operation.download')
    fireEvent.click(downloadButtons[0])

    await waitFor(() => {
      expect(getDocDownloadUrl).toHaveBeenCalled()
      expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('handles upgrade click on badge for sandbox plan', () => {
    render(<Compliance />)
    fireEvent.click(screen.getByRole('button'))
    const upgradeBadges = screen.getAllByText('upgradeBtn.encourageShort')
    fireEvent.click(upgradeBadges[0])
    expect(mockSetShowPricingModal).toHaveBeenCalled()
  })

  it('handles upgrade click on badge for non-sandbox plan', () => {
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      plan: {
        ...baseProviderContextValue.plan,
        type: Plan.professional,
      },
    })

    render(<Compliance />)
    fireEvent.click(screen.getByRole('button'))
    // SOC2 Type II is restricted for professional
    const upgradeBadges = screen.getAllByText('upgradeBtn.encourageShort')
    fireEvent.click(upgradeBadges[0])
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: ACCOUNT_SETTING_TAB.BILLING,
    })
  })
})
