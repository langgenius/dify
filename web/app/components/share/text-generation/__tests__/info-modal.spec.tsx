import type { SiteInfo } from '@/models/share'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AppInfoDialog } from '../info-modal'

const siteInfo: SiteInfo = {
  title: 'Test App',
  icon: '🚀',
  icon_type: 'emoji',
  icon_background: '#ffffff',
}

const renderModal = async (data: SiteInfo | undefined = siteInfo) => {
  const onClose = vi.fn()
  render(<AppInfoDialog open onOpenChange={onClose} data={data} />)
  await act(async () => vi.runAllTimers())
  return onClose
}

describe('AppInfoDialog', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('does not expose app information while hidden', () => {
    render(<AppInfoDialog open={false} onOpenChange={vi.fn()} data={siteInfo} />)

    expect(screen.queryByText('Test App')).not.toBeInTheDocument()
  })

  it('shows the app identity when opened', async () => {
    await renderModal()

    expect(screen.getByRole('dialog', { name: 'Test App' })).toBeInTheDocument()
  })

  it('names the dialog when the app title is empty', async () => {
    await renderModal({ ...siteInfo, title: '' })

    expect(screen.getByRole('dialog', { name: 'common.userProfile.about' })).toBeInTheDocument()
  })

  it('associates the existing introduction with the dialog', async () => {
    await renderModal({ ...siteInfo, description: 'Assistant for daily work' })

    expect(screen.getByRole('dialog', { name: 'Test App' })).toHaveAccessibleDescription(
      'Assistant for daily work',
    )
  })

  it('shows the copyright and custom disclaimer when provided', async () => {
    await renderModal({
      ...siteInfo,
      copyright: 'Dify AI',
      custom_disclaimer: 'Custom disclaimer',
    })

    expect(
      screen.getByText(`Copyright © ${new Date().getFullYear()} Dify AI. All Rights Reserved.`),
    ).toBeInTheDocument()
    expect(screen.getByText('Custom disclaimer')).toBeInTheDocument()
  })

  it('closes from the dialog close button', async () => {
    const onClose = await renderModal()

    fireEvent.click(screen.getByRole('button'))

    expect(onClose).toHaveBeenCalledWith(false, expect.anything())
  })
})
