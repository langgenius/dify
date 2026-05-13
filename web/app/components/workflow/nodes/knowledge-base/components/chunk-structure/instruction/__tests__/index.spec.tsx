import { render, screen } from '@testing-library/react'
import Instruction from '../index'

describe('ChunkStructureInstruction', () => {
  // The instruction card should render learning copy without an external docs link.
  describe('Rendering', () => {
    it('should render the title and message without learn-more link', () => {
      render(<Instruction className="custom-class" />)

      expect(screen.getByText('workflow.nodes.knowledgeBase.chunkStructureTip.title')).toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.knowledgeBase.chunkStructureTip.message')).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'workflow.nodes.knowledgeBase.chunkStructureTip.learnMore' }),
      ).not.toBeInTheDocument()
    })
  })
})
