import type { SiteInfo } from '@/models/share'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  await act(async () => vi.runAllTimers())
  return onClose
}

describe('InfoModal', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('does not expose app information while hidden', () => {
    render(<InfoModal isShow={false} onClose={vi.fn()} data={siteInfo} />)

    expect(screen.queryByText('Test App')).not.toBeInTheDocument()
  })

  it('shows the app identity when opened', async () => {
    await renderModal()

    expect(screen.getByText('Test App')).toBeInTheDocument()
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

    expect(onClose).toHaveBeenCalledOnce()
  })
})
