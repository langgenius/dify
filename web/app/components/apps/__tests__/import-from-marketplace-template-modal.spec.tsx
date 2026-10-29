import { act, isInaccessible, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { marketplaceQuery } from '@/service/marketplace'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import ImportFromMarketplaceTemplateModal from '../import-from-marketplace-template-modal'

const getTemplate = vi.hoisted(() => vi.fn())
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceQuery: {
      ...actual.marketplaceQuery,
      templateDetail: {
        ...actual.marketplaceQuery.templateDetail,
        queryOptions: (
          options: Parameters<typeof actual.marketplaceQuery.templateDetail.queryOptions>[0],
        ) => ({
          ...actual.marketplaceQuery.templateDetail.queryOptions(options),
          queryFn: getTemplate,
        }),
      },
    },
  }
})

const template = {
  data: {
    id: 'human-input-writing',
    template_name: 'Human Input: Writing Assistant',
    overview: 'Send your creative brief, get a high-quality draft, and review before publishing.',
    icon: 'technologist',
    icon_background: '#D1FAE5',
    icon_file_key: '',
    publisher_unique_handle: 'langgenius',
    usage_count: 261,
    categories: ['operations'],
  },
}

const renderModal = ({ pending = false } = {}) => {
  const queryClient = createConsoleQueryClient()
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  if (!pending) {
    queryClient.setQueryData(
      marketplaceQuery.templateDetail.queryOptions({
        input: { params: { templateId: template.data.id } },
      }).queryKey,
      template,
    )
  }
  renderWithConsoleQuery(
    <ImportFromMarketplaceTemplateModal
      templateId={template.data.id}
      onClose={onClose}
      onConfirm={onConfirm}
    />,
    { queryClient },
  )
  return { onClose, onConfirm }
}

describe('ImportFromMarketplaceTemplateModal', () => {
  beforeEach(() => {
    getTemplate.mockReset().mockResolvedValue(template)
  })

  it('shows the template with its decorative emoji and closes from its named control', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()

    expect(screen.getByText('Human Input: Writing Assistant')).toBeInTheDocument()
    expect(screen.queryByText('technologist')).not.toBeInTheDocument()
    expect(isInaccessible(screen.getByText('🧑‍💻'))).toBe(true)
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('blocks import while loading and after the template request fails', async () => {
    const user = userEvent.setup()
    let rejectRequest!: (reason: Error) => void
    getTemplate.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject
        }),
    )
    const { onConfirm } = renderModal({ pending: true })

    expect(screen.getByText('common.loading').closest('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    const confirmButton = screen.getByRole('button', {
      name: 'app.marketplace.template.importConfirm',
    })
    expect(confirmButton).toBeDisabled()
    await user.click(confirmButton)
    expect(onConfirm).not.toHaveBeenCalled()

    await act(async () => {
      rejectRequest(new Error('Template unavailable'))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'app.marketplace.template.fetchFailed',
    )
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
    expect(confirmButton).toBeDisabled()
    await user.click(confirmButton)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
