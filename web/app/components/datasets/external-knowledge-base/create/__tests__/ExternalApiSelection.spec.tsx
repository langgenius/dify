import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  setShowExternalKnowledgeAPIModal: vi.fn(),
  externalKnowledgeApiList: [] as Array<{
    id: string
    name: string
    settings: { endpoint: string }
  }>,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalKnowledgeAPIModal: mocks.setShowExternalKnowledgeAPIModal,
  }),
}))

vi.mock('@/context/external-knowledge-api-context', () => ({
  useExternalKnowledgeApi: () => ({
    externalKnowledgeApiList: mocks.externalKnowledgeApiList,
  }),
}))

vi.mock('../ExternalApiSelect', () => ({
  default: ({
    items,
    onSelect,
  }: {
    items: Array<{ value: string; name: string }>
    onSelect: (item: { value: string; name: string }) => void
  }) => (
    <div>
      {items.map((item) => (
        <button type="button" key={item.value} onClick={() => onSelect(item)}>
          {item.name}
        </button>
      ))}
    </div>
  ),
}))

const { default: ExternalApiSelection } = await import('../ExternalApiSelection')

const defaultProps = {
  external_knowledge_api_id: '',
  external_knowledge_id: '',
  onChange: vi.fn(),
}

describe('ExternalApiSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.externalKnowledgeApiList = [
      { id: 'api-1', name: 'API One', settings: { endpoint: 'https://api1.com' } },
      { id: 'api-2', name: 'API Two', settings: { endpoint: 'https://api2.com' } },
    ]
  })

  it('selects an external knowledge API', async () => {
    const user = userEvent.setup()
    render(<ExternalApiSelection {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'API Two' }))

    expect(defaultProps.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ external_knowledge_api_id: 'api-2' }),
    )
  })

  it('updates the external knowledge ID', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const Harness = () => {
      const [value, setValue] = useState(defaultProps)
      return (
        <ExternalApiSelection
          {...value}
          onChange={(nextValue) => {
            setValue((current) => ({ ...current, ...nextValue }))
            onChange(nextValue)
          }}
        />
      )
    }
    render(<Harness />)

    await user.type(screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder'), 'kb-123')

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ external_knowledge_id: 'kb-123' }),
    )
  })

  it('opens external API creation when no API exists', async () => {
    const user = userEvent.setup()
    mocks.externalKnowledgeApiList = []
    render(<ExternalApiSelection {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'dataset.noExternalKnowledge' }))

    expect(mocks.setShowExternalKnowledgeAPIModal).toHaveBeenCalledOnce()
  })
})
