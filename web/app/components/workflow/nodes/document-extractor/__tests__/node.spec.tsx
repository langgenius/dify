import type { DocExtractorNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useNodes: vi.fn(),
  }
})

vi.mock('@/app/components/workflow/nodes/_base/components/variable/variable-label', () => ({
  VariableLabelInNode: ({
    variables,
    nodeTitle,
    nodeType,
  }: {
    variables: string[]
    nodeTitle?: string
    nodeType?: BlockEnum
  }) => <div>{`${nodeTitle}:${nodeType}:${variables.join('.')}`}</div>,
}))

const mockUseNodes = vi.mocked(useNodes)

const createData = (overrides: Partial<DocExtractorNodeType> = {}): DocExtractorNodeType => ({
  title: 'Document Extractor',
  desc: '',
  type: BlockEnum.DocExtractor,
  variable_selector: ['node-1', 'files'],
  is_array_file: false,
  ...overrides,
})

describe('document-extractor/node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodes.mockReturnValue([
      {
        id: 'node-1',
        data: {
          title: 'Input Files',
          type: BlockEnum.Start,
        },
      },
    ] as ReturnType<typeof useNodes>)
  })

  it('renders nothing when no input variable is configured', () => {
    const { container } = render(
      <Node
        id="doc-node"
        data={createData({ variable_selector: [] })}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the selected input variable label', () => {
    render(
      <Node
        id="doc-node"
        data={createData()}
      />,
    )

    expect(screen.getByText('workflow.nodes.docExtractor.inputVar')).toBeInTheDocument()
    expect(screen.getByText('Input Files:start:node-1.files')).toBeInTheDocument()
  })
})
