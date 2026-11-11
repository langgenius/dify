import type { DocExtractorNodeType } from '../types'
import { screen } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

const data: DocExtractorNodeType = {
  title: 'Document Extractor',
  desc: '',
  type: BlockEnum.DocExtractor,
  variable_selector: ['source', 'files'],
  is_array_file: false,
}

describe('document-extractor/node', () => {
  it('resolves the selected file variable to its source node in the real graph', () => {
    renderWorkflowFlowComponent(<Node id="doc-node" data={data} />, {
      nodes: [
        createNode({ id: 'unrelated', data: { type: BlockEnum.Start, title: 'Unrelated input' } }),
        createNode({ id: 'source', data: { type: BlockEnum.Start, title: 'Input Files' } }),
      ],
      edges: [],
    })

    expect(screen.getByText('workflow.nodes.docExtractor.inputVar')).toBeInTheDocument()
    expect(screen.getByText('Input Files')).toBeInTheDocument()
    expect(screen.getByText('files')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated input')).not.toBeInTheDocument()
  })
})
