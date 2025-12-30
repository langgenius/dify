import type { ModalContextState } from '@/context/modal-context'
import type { ProviderContextState } from '@/context/provider-context'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Toast from '@/app/components/base/toast'
import { Plan } from '@/app/components/billing/type'
import { parseParamsSchema } from '@/service/tools'
import EditCustomCollectionModal from './index'

vi.mock('ahooks', async () => {
  const actual = await vi.importActual<typeof import('ahooks')>('ahooks')
  return {
    ...actual,
    useDebounce: (value: unknown) => value,
  }
})

vi.mock('@/service/tools', () => ({
  parseParamsSchema: vi.fn(),
}))
const parseParamsSchemaMock = vi.mocked(parseParamsSchema)

const mockSetShowPricingModal = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: (): ModalContextState => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
    setShowApiBasedExtensionModal: vi.fn(),
    setShowModerationSettingModal: vi.fn(),
    setShowExternalDataToolModal: vi.fn(),
    setShowPricingModal: mockSetShowPricingModal,
    setShowAnnotationFullModal: vi.fn(),
    setShowModelModal: vi.fn(),
    setShowExternalKnowledgeAPIModal: vi.fn(),
    setShowModelLoadBalancingModal: vi.fn(),
    setShowOpeningModal: vi.fn(),
    setShowUpdatePluginModal: vi.fn(),
    setShowEducationExpireNoticeModal: vi.fn(),
    setShowTriggerEventsLimitModal: vi.fn(),
  }),
}))

const mockUseProviderContext = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('@/context/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/context/i18n')>('@/context/i18n')
  return {
    ...actual,
    useDocLink: () => (path?: string) => `https://docs.example.com${path ?? ''}`,
  }
})

describe('EditCustomCollectionModal', () => {
  const mockOnHide = vi.fn()
  const mockOnAdd = vi.fn()
  const mockOnEdit = vi.fn()
  const mockOnRemove = vi.fn()
  const toastNotifySpy = vi.spyOn(Toast, 'notify')

  beforeEach(() => {
    vi.clearAllMocks()
    toastNotifySpy.mockClear()
    parseParamsSchemaMock.mockResolvedValue({
      parameters_schema: [],
      schema_type: 'openapi',
    })
    mockUseProviderContext.mockReturnValue({
      plan: {
        type: Plan.sandbox,
      },
      enableBilling: false,
      webappCopyrightEnabled: true,
    } as ProviderContextState)
  })

  const renderModal = () => render(
    <EditCustomCollectionModal
      payload={undefined}
      onHide={mockOnHide}
      onAdd={mockOnAdd}
      onEdit={mockOnEdit}
      onRemove={mockOnRemove}
    />,
  )

  it('shows an error when the provider name is missing', async () => {
    renderModal()

    const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
    fireEvent.change(schemaInput, { target: { value: '{}' } })
    await waitFor(() => {
      expect(parseParamsSchemaMock).toHaveBeenCalledWith('{}')
    })

    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(toastNotifySpy).toHaveBeenCalledWith(expect.objectContaining({
        message: 'common.errorMsg.fieldRequired:{"field":"tools.createTool.name"}',
        type: 'error',
      }))
    })
    expect(mockOnAdd).not.toHaveBeenCalled()
  })

  it('shows an error when the schema is missing', async () => {
    renderModal()

    const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
    fireEvent.change(providerInput, { target: { value: 'provider' } })

    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(toastNotifySpy).toHaveBeenCalledWith(expect.objectContaining({
        message: 'common.errorMsg.fieldRequired:{"field":"tools.createTool.schema"}',
        type: 'error',
      }))
    })
    expect(mockOnAdd).not.toHaveBeenCalled()
  })

  it('saves a valid custom collection', async () => {
    renderModal()
    const providerInput = screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder')
    fireEvent.change(providerInput, { target: { value: 'provider' } })

    const schemaInput = screen.getByPlaceholderText('tools.createTool.schemaPlaceHolder')
    fireEvent.change(schemaInput, { target: { value: '{}' } })

    await waitFor(() => {
      expect(parseParamsSchemaMock).toHaveBeenCalledWith('{}')
    })

    await act(async () => {
      fireEvent.click(screen.getByText('common.operation.save'))
    })

    await waitFor(() => {
      expect(mockOnAdd).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'provider',
        schema: '{}',
        schema_type: 'openapi',
        credentials: {
          auth_type: 'none',
        },
        labels: [],
      }))
      expect(toastNotifySpy).not.toHaveBeenCalled()
    })
  })
})
