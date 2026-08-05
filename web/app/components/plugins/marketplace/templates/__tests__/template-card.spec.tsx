import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TemplateCard from '../template-card'

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
  it('opens a Marketplace template through the Dify import flow', () => {
    render(<TemplateCard partnerText="Verified by a Dify partner" template={template} />)

    expect(screen.getByRole('link', { name: 'Campaign planner' })).toHaveAttribute(
      'href',
      '/apps?template-id=template%2Fone',
    )
    expect(screen.getByText('dify')).toBeInTheDocument()
    expect(screen.getByText('1.2k')).toBeInTheDocument()
    expect(screen.getByLabelText('Verified by a Dify partner')).toBeInTheDocument()
  })
})
