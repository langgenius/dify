import { fireEvent, render, screen } from '@testing-library/react'
import DeprecatedModelTrigger from './deprecated-model-trigger'

vi.mock('../model-icon', () => ({
  default: ({ modelName }: { modelName: string }) => <span>{modelName}</span>,
}))

const mockUseProviderContext = vi.hoisted(() => vi.fn())
vi.mock('@/context/provider-context', () => ({
  useProviderContext: mockUseProviderContext,
}))

describe('DeprecatedModelTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProviderContext.mockReturnValue({
      modelProviders: [{ provider: 'someone-else' }, { provider: 'openai' }],
    })
  })

  it('should render model name', () => {
    render(<DeprecatedModelTrigger modelName="gpt-deprecated" providerName="openai" />)
    expect(screen.getAllByText('gpt-deprecated').length).toBeGreaterThan(0)
  })

  it('should show deprecated tooltip when warn icon is hovered', async () => {
    const { container } = render(
      <DeprecatedModelTrigger
        modelName="gpt-deprecated"
        providerName="openai"
        showWarnIcon
      />,
    )

    const tooltipTrigger = container.querySelector('[data-state]') as HTMLElement
    fireEvent.mouseEnter(tooltipTrigger)

    expect(await screen.findByText('common.modelProvider.deprecated')).toBeInTheDocument()
  })

  it('should render when provider is not found', () => {
    mockUseProviderContext.mockReturnValue({
      modelProviders: [{ provider: 'someone-else' }],
    })

    render(<DeprecatedModelTrigger modelName="gpt-deprecated" providerName="openai" />)
    expect(screen.getAllByText('gpt-deprecated').length).toBeGreaterThan(0)
  })

  it('should not show deprecated tooltip when warn icon is disabled', async () => {
    render(
      <DeprecatedModelTrigger
        modelName="gpt-deprecated"
        providerName="openai"
        showWarnIcon={false}
      />,
    )

    expect(screen.queryByText('common.modelProvider.deprecated')).not.toBeInTheDocument()
  })
})
