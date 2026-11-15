import type { SiteInfo } from '@/models/share'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import InfoModal from '../info-modal'

const siteInfo: SiteInfo = {
  title: 'Test App',
  icon: '🚀',
  icon_type: 'emoji',
  icon_background: '#ffffff',
}

const renderModal = async (data: SiteInfo | undefined = siteInfo) => {
  const onClose = vi.fn()
  render(<InfoModal isShow onClose={onClose} data={data} />)
  return onClose
}

describe('InfoModal', () => {
  it('does not expose app information while hidden', () => {
    render(<InfoModal isShow={false} onClose={vi.fn()} data={siteInfo} />)

    expect(screen.queryByText('Test App')).not.toBeInTheDocument()
  })

  it('names the dialog when the app title is empty', async () => {
    await renderModal({ ...siteInfo, title: '' })

    expect(screen.getByRole('dialog', { name: 'common.userProfile.about' })).toBeInTheDocument()
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

    const user = userEvent.setup()
    const dialog = screen.getByRole('dialog', { name: 'Test App' })
    await user.click(within(dialog).getByRole('button'))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
