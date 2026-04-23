import type { Node } from '../types'
import { screen } from '@testing-library/react'
import CandidateNode from '../candidate-node'
import { BlockEnum } from '../types'
import { renderWorkflowComponent } from './workflow-test-env'

vi.mock('../candidate-node-main', () => ({
  default: ({ candidateNode }: { candidateNode: Node }) => (
    <div data-testid="candidate-node-main">{candidateNode.id}</div>
  ),
}))

const createCandidateNode = (): Node => ({
  id: 'candidate-node-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.Start,
    title: 'Candidate node',
    desc: 'candidate',
  },
})

describe('CandidateNode', () => {
  it('should not render when candidateNode is missing from the workflow store', () => {
    renderWorkflowComponent(<CandidateNode />)

    expect(screen.queryByTestId('candidate-node-main')).not.toBeInTheDocument()
  })

  it('should render CandidateNodeMain with the stored candidate node', () => {
    renderWorkflowComponent(<CandidateNode />, {
      initialStoreState: {
        candidateNode: createCandidateNode(),
      },
    })

    expect(screen.getByTestId('candidate-node-main')).toHaveTextContent('candidate-node-1')
  })
})
