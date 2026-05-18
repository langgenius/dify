import type { StartNodeType } from '../types'
import { screen } from '@testing-library/react'
import { renderNodeComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import Node from '../node'

const createNodeData = (overrides: Partial<StartNodeType> = {}): StartNodeType => ({
  title: 'Start',
  desc: '',
  type: BlockEnum.Start,
  variables: [{
    label: 'Question',
    variable: 'query',
    type: InputVarType.textInput,
    required: true,
  }],
  ...overrides,
})

describe('StartNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Start variables should render required metadata and gracefully disappear when empty.
  describe('Rendering', () => {
    it('should render configured input variables and required markers', () => {
      renderNodeComponent(Node, createNodeData({
        variables: [
          {
            label: 'Question',
            variable: 'query',
            type: InputVarType.textInput,
            required: true,
          },
          {
            label: 'Count',
            variable: 'count',
            type: InputVarType.number,
            required: false,
          },
        ],
      }))

      expect(screen.getByText('query')).toBeInTheDocument()
      expect(screen.getByText('count')).toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.start.required')).toBeInTheDocument()
    })

    it('should render nothing when there are no start variables', () => {
      const { container } = renderNodeComponent(Node, createNodeData({
        variables: [],
      }))

      expect(container).toBeEmptyDOMElement()
    })
  })
})
