import { fireEvent, render, screen } from '@testing-library/react'
import ImportFromMarketplaceTemplateModal from '../import-from-marketplace-template-modal'

const mockUseMarketplaceTemplateDetail = vi.fn()
const mockFetchMarketplaceTemplateDSL = vi.fn()

vi.mock('@/service/marketplace-templates', () => ({
  useMarketplaceTemplateDetail: (...args: unknown[]) => mockUseMarketplaceTemplateDetail(...args),
  fetchMarketplaceTemplateDSL: (...args: unknown[]) => mockFetchMarketplaceTemplateDSL(...args),
}))

describe('ImportFromMarketplaceTemplateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMarketplaceTemplateDetail.mockReturnValue({
      data: {
        data: {
          id: 'human-input-writing',
          template_name: 'Human Input: Writing Assistant',
          overview:
            'Send your creative brief, get a high-quality draft, and review before publishing.',
          icon: 'technologist',
          icon_background: '#D1FAE5',
          icon_file_key: '',
          publisher_unique_handle: 'langgenius',
          usage_count: 261,
          categories: ['operations'],
        },
      },
      isLoading: false,
      isError: false,
    })
  })

  it('renders marketplace emoji icons without exposing the emoji id as text', () => {
    render(
      <ImportFromMarketplaceTemplateModal
        templateId="human-input-writing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('Human Input: Writing Assistant')).toBeInTheDocument()
    expect(screen.queryByText('technologist')).not.toBeInTheDocument()
    expect(
      screen.getByRole('dialog', { name: /marketplace\.template\.modalTitle/ }),
    ).toBeInTheDocument()
  })

  it('exposes a named close control', () => {
    const onClose = vi.fn()
    render(
      <ImportFromMarketplaceTemplateModal
        templateId="human-input-writing"
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /operation\.close/ }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('announces loading and error states', () => {
    mockUseMarketplaceTemplateDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })
    const { rerender } = render(
      <ImportFromMarketplaceTemplateModal
        templateId="human-input-writing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading...')

    mockUseMarketplaceTemplateDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    })
    rerender(
      <ImportFromMarketplaceTemplateModal
        templateId="human-input-writing"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('app.marketplace.template.fetchFailed')
  })
})
