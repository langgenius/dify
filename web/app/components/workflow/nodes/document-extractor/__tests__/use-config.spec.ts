import type { DocExtractorNodeType } from '../types'
import { act } from '@testing-library/react'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import useConfig from '../use-config'

const createData = (overrides: Partial<DocExtractorNodeType> = {}): DocExtractorNodeType => ({
  title: 'Document Extractor',
  desc: '',
  type: BlockEnum.DocExtractor,
  variable_selector: ['node-1', 'files'],
  is_array_file: false,
  ...overrides,
})

describe('document-extractor/use-config', () => {
  it('derives single and multiple file selection from real upstream outputs', () => {
    const data = createData()
    const source = createNode({
      id: 'source',
      data: {
        type: BlockEnum.Start,
        variables: [
          {
            variable: 'attachment',
            label: 'Attachment',
            type: InputVarType.singleFile,
            required: false,
          },
          {
            variable: 'attachments',
            label: 'Attachments',
            type: InputVarType.multiFiles,
            required: false,
          },
        ],
      },
    })
    const { result } = renderNodeConfig(useConfig, data, {
      nodes: [source, createNode({ id: 'node', data })],
      edges: [createEdge({ source: 'source', target: 'node' })],
    })
    act(() => result.current.config.handleVarChanges(['source', 'attachments']))
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      variable_selector: ['source', 'attachments'],
      is_array_file: true,
    })
    act(() => result.current.config.handleVarChanges(['source', 'attachment']))
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      variable_selector: ['source', 'attachment'],
      is_array_file: false,
    })
  })
  it('only accepts files and file arrays', () => {
    const { result } = renderNodeConfig(useConfig, createData())
    expect(result.current.config.filterVar({ variable: 'file', type: VarType.file })).toBe(true)
    expect(result.current.config.filterVar({ variable: 'files', type: VarType.arrayFile })).toBe(
      true,
    )
    expect(result.current.config.filterVar({ variable: 'text', type: VarType.string })).toBe(false)
  })
})
