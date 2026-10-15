import type {
  WorkflowToolOutputSource,
  WorkflowToolProviderOutputParameter,
  WorkflowToolProviderOutputSchema,
} from '../../types'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import {
  buildWorkflowOutputParameters,
  getDuplicateWorkflowOutputGroups,
  getNonConflictingWorkflowOutputNames,
  getSourceNodeDisplayName,
  getUniqueWorkflowOutputSources,
} from '../utils'

describe('workflow output sources', () => {
  const duplicateSources: WorkflowToolOutputSource[] = [
    { nodeId: 'end-success', nodeTitle: 'Output', outputIndex: 0 },
    { nodeId: 'end-fallback', nodeTitle: 'Output', outputIndex: 0 },
  ]

  it('deduplicates source nodes while preserving their order', () => {
    const outputs: WorkflowToolProviderOutputParameter[] = [
      { name: 'result', description: '', source: duplicateSources[0] },
      { name: 'result', description: '', source: duplicateSources[0] },
      { name: 'result', description: '', source: duplicateSources[1] },
    ]

    expect(getUniqueWorkflowOutputSources(outputs)).toEqual(duplicateSources)
  })

  it('numbers sources with the same title without exposing their node IDs', () => {
    expect(getSourceNodeDisplayName(duplicateSources[0]!, duplicateSources)).toBe('Output (1/2)')
    expect(getSourceNodeDisplayName(duplicateSources[1]!, duplicateSources)).toBe('Output (2/2)')
  })
})

describe('getNonConflictingWorkflowOutputNames', () => {
  const start = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })
  const branch = createNode({ id: 'branch', data: { type: BlockEnum.IfElse, title: 'If/Else' } })
  const end = (id: string, type: VarType = VarType.string) =>
    createNode({
      id,
      data: {
        type: BlockEnum.End,
        title: id,
        outputs: [{ variable: 'result', value_type: type, value_selector: ['sys', 'result'] }],
      },
    })
  const edge = (source: string, target: string, sourceHandle?: string) =>
    createEdge({ source, target, ...(sourceHandle ? { sourceHandle } : {}) })
  const nodes = [start, branch, end('end-true'), end('end-false')]
  const edges = [
    edge('start', 'branch'),
    edge('branch', 'end-true', 'true'),
    edge('branch', 'end-false', 'false'),
  ]

  it('allows same-typed output names behind opposite IF/ELSE handles', () => {
    expect(getNonConflictingWorkflowOutputNames(nodes, edges)).toEqual(['result'])
  })

  it('keeps the warning for outputs that can run together', () => {
    expect(
      getNonConflictingWorkflowOutputNames(nodes, [
        edge('start', 'end-true'),
        edge('start', 'end-false'),
      ]),
    ).toEqual([])
  })

  it('keeps the warning when exclusive outputs have conflicting types', () => {
    expect(
      getNonConflictingWorkflowOutputNames(
        [start, branch, end('end-true'), end('end-false', VarType.object)],
        edges,
      ),
    ).toEqual([])
  })
})

describe('getDuplicateWorkflowOutputGroups', () => {
  it('groups trimmed duplicate names while preserving their End node sources', () => {
    const params: WorkflowToolProviderOutputParameter[] = [
      {
        name: ' result ',
        description: 'Success output',
        source: { nodeId: 'end-success', nodeTitle: 'Success End', outputIndex: 0 },
      },
      {
        name: 'result',
        description: 'Fallback output',
        source: { nodeId: 'end-fallback', nodeTitle: 'Fallback End', outputIndex: 0 },
      },
      {
        name: 'unique',
        description: 'Unique output',
        source: { nodeId: 'end-unique', nodeTitle: 'Unique End', outputIndex: 0 },
      },
    ]

    const result = getDuplicateWorkflowOutputGroups(params)

    expect([...result.keys()]).toEqual(['result'])
    expect(result.get('result')?.map((item) => item.source?.nodeTitle)).toEqual([
      'Success End',
      'Fallback End',
    ])
  })
})

describe('buildWorkflowOutputParameters', () => {
  it('returns provided output parameters when array input exists', () => {
    const params: WorkflowToolProviderOutputParameter[] = [
      { name: 'text', description: 'final text', type: VarType.string },
    ]

    const result = buildWorkflowOutputParameters(params, null)

    expect(result).toEqual(params)
  })

  it('fills missing output description and type from schema when array input exists', () => {
    const params: WorkflowToolProviderOutputParameter[] = [
      { name: 'answer', description: '', type: undefined },
      { name: 'files', description: 'keep this description', type: VarType.arrayFile },
    ]
    const schema: WorkflowToolProviderOutputSchema = {
      type: 'object',
      properties: {
        answer: {
          type: VarType.string,
          description: 'Generated answer',
        },
        files: {
          type: VarType.arrayFile,
          description: 'Schema files description',
        },
      },
    }

    const result = buildWorkflowOutputParameters(params, schema)

    expect(result).toEqual([
      { name: 'answer', description: 'Generated answer', type: VarType.string },
      { name: 'files', description: 'keep this description', type: VarType.arrayFile },
    ])
  })

  it('falls back to empty description when both payload and schema descriptions are missing', () => {
    const params: WorkflowToolProviderOutputParameter[] = [
      { name: 'missing_desc', description: '', type: undefined },
    ]
    const schema: WorkflowToolProviderOutputSchema = {
      type: 'object',
      properties: {
        other_field: {
          type: VarType.string,
          description: 'Other',
        },
      },
    }

    const result = buildWorkflowOutputParameters(params, schema)

    expect(result).toEqual([{ name: 'missing_desc', description: '', type: undefined }])
  })

  it('derives parameters from schema when explicit array missing', () => {
    const schema: WorkflowToolProviderOutputSchema = {
      type: 'object',
      properties: {
        answer: {
          type: VarType.string,
          description: 'AI answer',
        },
        attachments: {
          type: VarType.arrayFile,
          description: 'Supporting files',
        },
        unknown: {
          type: 'custom',
          description: 'Unsupported type',
        },
      },
    }

    const result = buildWorkflowOutputParameters(undefined, schema)

    expect(result).toEqual([
      { name: 'answer', description: 'AI answer', type: VarType.string },
      { name: 'attachments', description: 'Supporting files', type: VarType.arrayFile },
      { name: 'unknown', description: 'Unsupported type', type: undefined },
    ])
  })

  it('returns empty array when no source information is provided', () => {
    expect(buildWorkflowOutputParameters(null, null)).toEqual([])
  })

  it('derives parameters from schema when explicit array is empty', () => {
    const schema: WorkflowToolProviderOutputSchema = {
      type: 'object',
      properties: {
        output_text: {
          type: VarType.string,
          description: 'Output text',
        },
      },
    }

    const result = buildWorkflowOutputParameters([], schema)

    expect(result).toEqual([
      { name: 'output_text', description: 'Output text', type: VarType.string },
    ])
  })

  it('returns undefined type when schema output type is missing', () => {
    const schema = {
      type: 'object',
      properties: {
        answer: {
          description: 'Answer without type',
        },
      },
    } as unknown as WorkflowToolProviderOutputSchema

    const result = buildWorkflowOutputParameters(undefined, schema)

    expect(result).toEqual([
      { name: 'answer', description: 'Answer without type', type: undefined },
    ])
  })

  it('falls back to empty description when schema-derived description is missing', () => {
    const schema = {
      type: 'object',
      properties: {
        answer: {
          type: VarType.string,
        },
      },
    } as unknown as WorkflowToolProviderOutputSchema

    const result = buildWorkflowOutputParameters(undefined, schema)

    expect(result).toEqual([{ name: 'answer', description: '', type: VarType.string }])
  })
})
