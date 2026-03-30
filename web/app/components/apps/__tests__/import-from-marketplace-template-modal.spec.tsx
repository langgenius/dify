import type { MarketplaceTemplate } from '@/service/marketplace-templates'
import { skipToken } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'

import ImportFromMarketplaceTemplateModal from '../import-from-marketplace-template-modal'

const {
  mockUseQuery,
  mockTemplateDetailQueryOptions,
  mockFetchMarketplaceTemplateDSL,
  mockToastError,
} = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockTemplateDetailQueryOptions: vi.fn(),
  mockFetchMarketplaceTemplateDSL: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: (options: unknown) => mockUseQuery(options),
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      if (options?.publisher)
        return `${key}:${options.publisher}`
      if (typeof options?.count === 'number')
        return `${key}:${options.count}`
      return key
    },
  }),
}))

vi.mock('@/config', () => ({
  MARKETPLACE_API_PREFIX: 'https://marketplace.example/api/v1',
  MARKETPLACE_URL_PREFIX: 'https://marketplace.example',
}))

vi.mock('@/service/client', () => ({
  marketplaceQuery: {
    templateDetail: {
      queryOptions: (options: unknown) => mockTemplateDetailQueryOptions(options),
    },
  },
}))

vi.mock('@/service/marketplace-templates', async () => {
  const actual = await vi.importActual<typeof import('@/service/marketplace-templates')>('@/service/marketplace-templates')
  return {
    ...actual,
    fetchMarketplaceTemplateDSL: (templateId: string) => mockFetchMarketplaceTemplateDSL(templateId),
  }
})

vi.mock('@/app/components/base/app-icon', () => ({
  default: (props: Record<string, string | undefined>) => React.createElement('div', {
    'data-testid': 'app-icon',
    'data-icon-type': props.iconType,
    'data-icon': props.icon,
    'data-background': props.background,
    'data-image-url': props.imageUrl,
  }),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props, children),
}))

vi.mock('@/app/components/base/ui/dialog', () => ({
  Dialog: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode
    onOpenChange?: (open: boolean) => void
  }) => React.createElement(
    'div',
    { 'data-testid': 'dialog-root' },
    React.createElement('button', {
      'data-testid': 'dialog-close',
      'onClick': () => onOpenChange?.(false),
    }, 'close'),
    children,
  ),
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => React.createElement('div', props, children),
  DialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => React.createElement('div', props, children),
  DialogCloseButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', { ...props, 'data-testid': 'dialog-close-button' }, 'close'),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const baseTemplate: MarketplaceTemplate = {
  id: 'template-id',
  publisher_type: 'individual',
  publisher_unique_handle: 'publisher-handle',
  template_name: 'Template Name',
  icon: '🚀',
  icon_background: '#FFEAD5',
  icon_file_key: 'icon-file',
  kind: 'classic',
  categories: [],
  deps_plugins: [],
  preferred_languages: [],
  overview: 'Template overview',
  readme: 'Template readme',
  partner_link: '',
  version: '1.0.0',
  status: 'published',
  usage_count: 3,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

describe('ImportFromMarketplaceTemplateModal', () => {
  const onConfirm = vi.fn()
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockTemplateDetailQueryOptions.mockImplementation(options => options)
  })

  it('should request template detail for the provided template id', () => {
    mockUseQuery.mockReturnValue({
      data: { data: baseTemplate },
      isLoading: false,
      isError: false,
    })

    render(
      <ImportFromMarketplaceTemplateModal
        templateId="template-id"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    expect(mockTemplateDetailQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          templateId: 'template-id',
        },
      },
    })
  })

  it('should pass skipToken when template id is empty', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    })

    render(
      <ImportFromMarketplaceTemplateModal
        templateId=""
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    expect(mockTemplateDetailQueryOptions).toHaveBeenCalledWith({
      input: skipToken,
    })
  })

  it('should render loading state while fetching template detail', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })

    const { container } = render(
      <ImportFromMarketplaceTemplateModal
        templateId="template-id"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('should render error state and allow closing the modal', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    })

    render(
      <ImportFromMarketplaceTemplateModal
        templateId="template-id"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('marketplace.template.fetchFailed')).toBeInTheDocument()

    fireEvent.click(screen.getByText('newApp.Cancel'))
    fireEvent.click(screen.getByTestId('dialog-close'))

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('should render template information and marketplace link', () => {
    mockUseQuery.mockReturnValue({
      data: { data: baseTemplate },
      isLoading: false,
      isError: false,
    })

    render(
      <ImportFromMarketplaceTemplateModal
        templateId="template-id"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('marketplace.template.modalTitle')).toBeInTheDocument()
    expect(screen.getByText('Template Name')).toBeInTheDocument()
    expect(screen.getByText('marketplace.template.publishedBy:publisher-handle')).toBeInTheDocument()
    expect(screen.getByText('marketplace.template.overview')).toBeInTheDocument()
    expect(screen.getByText('Template overview')).toBeInTheDocument()
    expect(screen.getByText('marketplace.template.usageCount:3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'marketplace.template.viewOnMarketplace' })).toHaveAttribute(
      'href',
      'https://marketplace.example/templates/template-id',
    )
    expect(screen.getByTestId('app-icon')).toHaveAttribute('data-icon-type', 'image')
    expect(screen.getByTestId('app-icon')).toHaveAttribute(
      'data-image-url',
      'https://marketplace.example/api/v1/templates/template-id/icon',
    )
  })

  it('should fall back to emoji icons and hide optional sections when data is missing', () => {
    mockUseQuery.mockReturnValue({
      data: {
        data: {
          ...baseTemplate,
          icon_file_key: '',
          overview: '',
          usage_count: 0,
        },
      },
      isLoading: false,
      isError: false,
    })

    render(
      <ImportFromMarketplaceTemplateModal
        templateId="template-id"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    expect(screen.getByTestId('app-icon')).toHaveAttribute('data-icon-type', 'emoji')
    expect(screen.queryByText('marketplace.template.overview')).not.toBeInTheDocument()
    expect(screen.queryByText('marketplace.template.usageCount:0')).not.toBeInTheDocument()
  })

  it('should fetch the template DSL and confirm the import', async () => {
    mockUseQuery.mockReturnValue({
      data: { data: baseTemplate },
      isLoading: false,
      isError: false,
    })
    mockFetchMarketplaceTemplateDSL.mockResolvedValue('yaml-content')

    render(
      <ImportFromMarketplaceTemplateModal
        templateId="template-id"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByText('marketplace.template.importConfirm'))

    await waitFor(() => {
      expect(mockFetchMarketplaceTemplateDSL).toHaveBeenCalledWith('template-id')
      expect(onConfirm).toHaveBeenCalledWith('yaml-content', baseTemplate)
    })
  })

  it('should show a toast and re-enable the button when importing fails', async () => {
    mockUseQuery.mockReturnValue({
      data: { data: baseTemplate },
      isLoading: false,
      isError: false,
    })
    mockFetchMarketplaceTemplateDSL.mockRejectedValue(new Error('failed'))

    render(
      <ImportFromMarketplaceTemplateModal
        templateId="template-id"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    const importButton = screen.getByText('marketplace.template.importConfirm')
    fireEvent.click(importButton)

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('marketplace.template.importFailed')
    })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('marketplace.template.importConfirm')).not.toBeDisabled()
  })
})
