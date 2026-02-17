import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  setShowExternalKnowledgeAPIModal: vi.fn(),
  mutateExternalKnowledgeApis: vi.fn(),
  externalKnowledgeApiList: [] as Array<{ id: string, name: string, settings: { endpoint: string } }>,
}))

vi.mock('next/navigation', () => ({
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
    mutateExternalKnowledgeApis: mocks.mutateExternalKnowledgeApis,
  }),
}))

// Mock ExternalApiSelect as simple stub
type MockSelectItem = { value: string, name: string }
vi.mock('../ExternalApiSelect', () => ({
  default: ({ items, value, onSelect }: { items: MockSelectItem[], value?: string, onSelect: (item: MockSelectItem) => void }) => (
    <div data-testid="external-api-select">
      <span data-testid="select-value">{value}</span>
      <span data-testid="select-items-count">{items.length}</span>
      {items.map((item: MockSelectItem) => (
        <button key={item.value} data-testid={`select-${item.value}`} onClick={() => onSelect(item)}>
          {item.name}
        </button>
      ))}
    </div>
  ),
}))

const { default: ExternalApiSelection } = await import('../ExternalApiSelection')

describe('ExternalApiSelection', () => {
  const defaultProps = {
    external_knowledge_api_id: '',
    external_knowledge_id: '',
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.externalKnowledgeApiList = [
      { id: 'api-1', name: 'API One', settings: { endpoint: 'https://api1.com' } },
      { id: 'api-2', name: 'API Two', settings: { endpoint: 'https://api2.com' } },
    ]
  })

  describe('rendering', () => {
    it('should render API selection label', () => {
      render(<ExternalApiSelection {...defaultProps} />)
      expect(screen.getByText('dataset.externalAPIPanelTitle')).toBeInTheDocument()
    })

    it('should render knowledge ID label and input', () => {
      render(<ExternalApiSelection {...defaultProps} />)
      expect(screen.getByText('dataset.externalKnowledgeId')).toBeInTheDocument()
    })

    it('should render ExternalApiSelect when APIs exist', () => {
      render(<ExternalApiSelection {...defaultProps} />)
      expect(screen.getByTestId('external-api-select')).toBeInTheDocument()
      expect(screen.getByTestId('select-items-count').textContent).toBe('2')
    })

    it('should show add button when no APIs exist', () => {
      mocks.externalKnowledgeApiList = []
      render(<ExternalApiSelection {...defaultProps} />)
      expect(screen.getByText('dataset.noExternalKnowledge')).toBeInTheDocument()
    })
  })

  describe('interactions', () => {
    it('should call onChange when API selected', () => {
      render(<ExternalApiSelection {...defaultProps} />)
      fireEvent.click(screen.getByTestId('select-api-2'))
      expect(defaultProps.onChange).toHaveBeenCalledWith(
        expect.objectContaining({ external_knowledge_api_id: 'api-2' }),
      )
    })

    it('should call onChange when knowledge ID input changes', () => {
      render(<ExternalApiSelection {...defaultProps} />)
      const input = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')
      fireEvent.change(input, { target: { value: 'kb-123' } })
      expect(defaultProps.onChange).toHaveBeenCalledWith(
        expect.objectContaining({ external_knowledge_id: 'kb-123' }),
      )
    })

    it('should call setShowExternalKnowledgeAPIModal when add button clicked', () => {
      mocks.externalKnowledgeApiList = []
      render(<ExternalApiSelection {...defaultProps} />)
      fireEvent.click(screen.getByText('dataset.noExternalKnowledge'))
      expect(mocks.setShowExternalKnowledgeAPIModal).toHaveBeenCalledOnce()
    })
  })
})
