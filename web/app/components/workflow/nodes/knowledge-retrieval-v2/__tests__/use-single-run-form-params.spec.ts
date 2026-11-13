import type { KnowledgeRetrievalV2NodeType } from '../types'
import { act } from '@testing-library/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import useSingleRunFormParams from '../use-single-run-form-params'

const createData = (
  overrides: Partial<KnowledgeRetrievalV2NodeType> = {},
): KnowledgeRetrievalV2NodeType => ({
  title: 'Knowledge Retrieval v2',
  desc: '',
  type: BlockEnum.KnowledgeRetrievalV2,
  control_space_ids: ['space-1', 'space-2'],
  query_variable_selector: ['start', 'query'],
  query_attachment_selector: ['start', 'images'],
  top_n: 10,
  ...overrides,
})

const setup = (
  payload = createData(),
  initialValues: Record<string, unknown> = {},
  getInputVars: Parameters<typeof useSingleRunFormParams>[0]['getInputVars'] = () => [],
) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return renderWorkflowCanvasHook(
    () => {
      const [runInputData, setRunInputData] = useState(initialValues)
      const runInputDataRef = useRef(runInputData)
      useLayoutEffect(() => {
        runInputDataRef.current = runInputData
      }, [runInputData])
      return useSingleRunFormParams({
        id: 'retrieval-1',
        payload,
        runInputData,
        runInputDataRef,
        setRunInputData,
        getInputVars,
        toVarInputs: () => [],
      })
    },
    {
      queryClient,
      nodes: [
        createNode({
          id: 'start',
          data: {
            type: BlockEnum.Start,
            title: 'Start',
            variables: [
              { variable: 'query', label: 'Query', type: InputVarType.textInput, required: false },
              {
                variable: 'department',
                label: 'Department',
                type: InputVarType.textInput,
                required: false,
              },
              {
                variable: 'images',
                label: 'Images',
                type: InputVarType.multiFiles,
                required: false,
              },
            ],
          },
        }),
        createNode({ id: 'retrieval-1', data: payload }),
      ],
      edges: [createEdge({ source: 'start', target: 'retrieval-1' })],
    },
  )
}

describe('knowledge-retrieval-v2/use-single-run-form-params', () => {
  it('builds an image form whenever an attachment selector is configured', () => {
    const { result } = setup(createData(), {
      query: 'find this diagram',
      queryAttachment: ['file-1'],
    })

    expect(result.current.forms).toHaveLength(2)
    expect(result.current.forms[1]!.inputs).toEqual([
      expect.objectContaining({
        variable: 'queryAttachment',
        type: InputVarType.multiFiles,
        required: false,
      }),
    ])

    act(() => result.current.forms[1]!.onChange({ queryAttachment: ['file-2'] }))
    expect(result.current.forms[1]!.values).toEqual({ queryAttachment: ['file-2'] })
    expect(result.current.forms[0]!.values).toEqual({ query: 'find this diagram' })
    expect(result.current.getDependentVars()).toEqual([
      ['start', 'query'],
      ['start', 'images'],
    ])
    expect(result.current.getDependentVar('queryAttachment')).toEqual(['start', 'images'])
  })

  it('omits the image form when the node has no attachment selector', () => {
    const { result } = setup(createData({ query_attachment_selector: [] }))

    expect(result.current.forms).toHaveLength(1)
  })

  it('exposes metadata filter variables as single-run inputs and dependencies', () => {
    const current = { query: 'policy', '#start.department#': 'sales' }
    const getInputVars = (texts: string[]) =>
      texts.includes('{{#start.department#}}')
        ? [
            {
              label: 'department',
              variable: '#start.department#',
              type: InputVarType.textInput,
              required: true,
            },
          ]
        : []
    const { result } = setup(
      createData({
        query_attachment_selector: [],
        metadata_filtering_mode: MetadataFilteringModeEnum.manual,
        metadata_filtering_conditions: {
          logical_operator: LogicalOperator.and,
          conditions: [
            {
              id: 'condition-1',
              name: 'department',
              comparison_operator: ComparisonOperator.is,
              value: '{{#start.department#}}',
            },
          ],
        },
      }),
      current,
      getInputVars,
    )

    expect(result.current.forms).toHaveLength(2)
    expect(result.current.forms[1]!.inputs).toEqual([
      expect.objectContaining({ variable: '#start.department#' }),
    ])
    expect(result.current.forms[1]!.values).toEqual({ '#start.department#': 'sales' })
    expect(result.current.getDependentVars()).toContainEqual(['start', 'department'])

    act(() => result.current.forms[1]!.onChange({ '#start.department#': 'support' }))
    expect(result.current.forms[1]!.values).toEqual({ '#start.department#': 'support' })
    expect(result.current.forms[0]!.values).toEqual({ query: 'policy' })
  })
})
