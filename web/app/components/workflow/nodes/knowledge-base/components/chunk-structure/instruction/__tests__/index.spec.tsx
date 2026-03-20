import { render, screen } from '@testing-library/react'
import Instruction from '../index'

const mockUseDocLink = vi.hoisted(() => vi.fn())

vi.mock('@/context/i18n', () => ({
  useDocLink: mockUseDocLink,
}))

describe('ChunkStructureInstruction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseDocLink.mockReturnValue((path: string) => `https://docs.example.com${path}`)
  })

  // The instruction card should render the learning copy and link to the chunking guide.
  describe('Rendering', () => {
    it('should render the title, message, and learn-more link', () => {
      render(<Instruction className="custom-class" />)

      expect(screen.getByText('workflow.nodes.knowledgeBase.chunkStructureTip.title')).toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.knowledgeBase.chunkStructureTip.message')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'workflow.nodes.knowledgeBase.chunkStructureTip.learnMore' })).toHaveAttribute(
        'href',
        'https://docs.example.com/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text',
      )
    })
  })
})
