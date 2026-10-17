import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import { act } from '@testing-library/react'
import { useReactFlow } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { usePipeline } from '../use-pipeline'

const source = (id: string) =>
  createNode({ id, data: { type: BlockEnum.DataSource, datasource_parameters: {} } })
const consumer = (id: string, nodeId = 'source', variable = 'query') =>
  createNode({
    id,
    data: {
      type: BlockEnum.Code,
      variables: [{ variable: 'input', value_selector: ['rag', nodeId, variable] }],
      code_language: 'python3',
      code: '',
      outputs: {},
    },
  })
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })
const renderPipeline = (
  nodes: ReturnType<typeof createNode>[],
  edges: ReturnType<typeof edge>[] = [],
) =>
  renderWorkflowFlowHook(
    () => ({
      pipeline: usePipeline(),
      flow: useReactFlow<CodeNodeType>(),
    }),
    { nodes, edges },
  )

it('finds references along multiple downstream hops and ignores disconnected nodes', () => {
  const { result } = renderPipeline(
    [
      source('source'),
      consumer('middle', 'source', 'other'),
      consumer('leaf'),
      consumer('disconnected', 'source', 'isolated'),
    ],
    [edge('source', 'middle'), edge('middle', 'leaf')],
  )
  expect(result.current.pipeline.isVarUsedInNodes(['rag', 'source', 'query'])).toBe(true)
  expect(result.current.pipeline.isVarUsedInNodes(['rag', 'source', 'isolated'])).toBe(false)
  expect(result.current.pipeline.isVarUsedInNodes(['rag', 'missing', 'query'])).toBe(false)
})

it('renames shared inputs across entrances and clears references when the input is removed', () => {
  const { result } = renderPipeline(
    [source('one'), source('two'), consumer('joined', 'shared')],
    [edge('one', 'joined'), edge('two', 'joined')],
  )
  expect(result.current.pipeline.isVarUsedInNodes(['rag', 'shared', 'query'])).toBe(true)
  act(() =>
    result.current.pipeline.handleInputVarRename(
      'shared',
      ['rag', 'shared', 'query'],
      ['rag', 'shared', 'renamed'],
    ),
  )
  expect(result.current.flow.getNode('joined')?.data.variables).toEqual([
    { variable: 'input', value_selector: ['rag', 'shared', 'renamed'] },
  ])
  expect(result.current.pipeline.isVarUsedInNodes(['rag', 'shared', 'query'])).toBe(false)
  act(() => result.current.pipeline.removeUsedVarInNodes(['rag', 'shared', 'renamed']))
  expect(result.current.flow.getNode('joined')?.data.variables).toEqual([
    { variable: 'input', value_selector: [] },
  ])
})

it('does not change other fields or another entrance when renaming an entrance-specific input', () => {
  const { result } = renderPipeline(
    [
      source('source'),
      source('other'),
      consumer('used'),
      consumer('untouched', 'source', 'different'),
      consumer('other-branch'),
    ],
    [edge('source', 'used'), edge('source', 'untouched'), edge('other', 'other-branch')],
  )
  act(() =>
    result.current.pipeline.handleInputVarRename(
      'source',
      ['rag', 'source', 'query'],
      ['rag', 'source', 'renamed'],
    ),
  )
  expect(result.current.flow.getNode('used')?.data.variables[0]?.value_selector).toEqual([
    'rag',
    'source',
    'renamed',
  ])
  expect(result.current.flow.getNode('untouched')?.data.variables[0]?.value_selector).toEqual([
    'rag',
    'source',
    'different',
  ])
  expect(result.current.flow.getNode('other-branch')?.data.variables[0]?.value_selector).toEqual([
    'rag',
    'source',
    'query',
  ])
})
