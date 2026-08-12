import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'next-themes'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TemplateCard from '../template-card'

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('../../utils', () => ({
  getTemplateLinkInMarketplace: (
    currentTemplate: MarketplaceTemplate,
    params: { language: string; source?: string; theme?: string; view: string },
  ) =>
    `about:blank?templateId=${currentTemplate.id}&language=${params.language}&source=${params.source}&theme=${params.theme}&view=${params.view}`,
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div aria-hidden />,
}))

const template: MarketplaceTemplate = {
  id: 'template/one',
  template_name: 'Campaign planner',
  overview: 'Plan a launch campaign.',
  icon: '📄',
  icon_background: '#fff',
  icon_file_key: '',
  publisher_unique_handle: 'dify',
  usage_count: 1200,
  categories: ['marketing'],
  badges: ['partner'],
}

describe('TemplateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens template detail before starting the Dify import flow', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider forcedTheme="dark">
        <TemplateCard partnerText="Verified by a Dify partner" template={template} />
      </ThemeProvider>,
    )

    expect(screen.queryByRole('link', { name: 'Campaign planner' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Campaign planner' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()

    const frame = screen.getByTitle(
      'Campaign planner · plugin.detailPanel.operation.detail',
    ) as HTMLIFrameElement
    const marketplaceOrigin = new URL(frame.getAttribute('src')!, window.location.href).origin
    const installRequest = {
      type: 'dify-marketplace:install-template',
      templateId: template.id,
    }
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { ...installRequest, templateId: 'another-template' },
        origin: marketplaceOrigin,
        source: frame.contentWindow,
      }),
    )
    expect(mockPush).not.toHaveBeenCalled()

    fireEvent(
      window,
      new MessageEvent('message', {
        data: installRequest,
        origin: marketplaceOrigin,
        source: frame.contentWindow,
      }),
    )
    expect(mockPush).toHaveBeenCalledWith('/apps?template-id=template%2Fone')
    expect(screen.getByRole('link', { name: 'dify' })).toHaveAttribute(
      'href',
      '/marketplace/creator/dify?publisher_type=individual',
    )
    expect(screen.getByText('1.2k')).toBeInTheDocument()
    expect(screen.getByLabelText('Verified by a Dify partner')).toBeInTheDocument()
  })

  it('links the publisher to the internal creator profile without opening detail', () => {
    render(
      <ThemeProvider forcedTheme="dark">
        <TemplateCard partnerText="Verified by a Dify partner" template={template} />
      </ThemeProvider>,
    )

    const publisher = screen.getByRole('link', { name: 'dify' })
    expect(publisher).toHaveAttribute('href', '/marketplace/creator/dify?publisher_type=individual')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
