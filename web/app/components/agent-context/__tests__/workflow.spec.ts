import type { Edge, Node } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { buildWorkflowAgentContext, getWorkflowConstructionGuide, summarizeWorkflowGraph } from '../workflow'

describe('workflow agent context', () => {
  it('should summarize workflow nodes and edges for agents', () => {
    const nodes: Node[] = [
      {
        data: {
          desc: 'Workflow input',
          selected: false,
          title: 'Start',
          type: BlockEnum.Start,
          variables: [
            {
              label: 'Question',
              required: true,
              type: 'text-input',
              variable: 'query',
            },
          ],
        },
        id: 'start',
        position: { x: 0, y: 0 },
        type: 'custom',
      },
      {
        data: {
          desc: 'Generate answer',
          selected: true,
          title: 'LLM',
          type: BlockEnum.LLM,
        },
        id: 'llm',
        position: { x: 300, y: 0 },
        type: 'custom',
      },
    ] as Node[]
    const edges: Edge[] = [
      {
        data: {
          sourceType: BlockEnum.Start,
          targetType: BlockEnum.LLM,
        },
        id: 'edge-1',
        source: 'start',
        target: 'llm',
      },
    ] as Edge[]

    const context = buildWorkflowAgentContext({
      controlMode: 'pointer',
      edges,
      isListening: false,
      nodes,
      pathname: '/app/app-123/workflow',
      pluginCatalog: {
        buildInTools: [
          {
            id: 'petrus/quickbooks/quickbooks',
            label: { en_US: 'QuickBooks Online' },
            name: 'petrus/quickbooks/quickbooks',
            plugin_id: 'petrus/quickbooks',
            tools: [
              {
                label: { en_US: 'Record Expense' },
                name: 'create_purchase',
                parameters: [{ name: 'amount', required: true, type: 'number' }],
              },
            ],
            type: 'builtin',
          },
        ],
        triggerPlugins: [
          {
            events: [
              {
                identity: { label: { en_US: 'Transaction Activity' } },
                name: 'transaction',
                output_schema: { properties: { transaction_id: { type: 'string' } } },
                parameters: [],
              },
            ],
            label: { en_US: 'Mercury Transaction Trigger' },
            name: 'petrus/mercury_trigger/mercury_trigger',
            plugin_id: 'petrus/mercury_trigger',
            type: 'trigger',
          },
        ],
      },
    })

    expect(context).toMatchObject({
      graph: {
        edge_count: 1,
        node_count: 2,
        nodes: [
          {
            id: 'start',
            title: 'Start',
            type: BlockEnum.Start,
          },
          {
            id: 'llm',
            selected: true,
            title: 'LLM',
          },
        ],
      },
      plugin_catalog: {
        tools: {
          builtin: [
            expect.objectContaining({
              plugin_id: 'petrus/quickbooks',
              tools: [
                expect.objectContaining({
                  name: 'create_purchase',
                  required_parameters: ['amount'],
                }),
              ],
            }),
          ],
        },
        triggers: [
          expect.objectContaining({
            plugin_id: 'petrus/mercury_trigger',
          }),
        ],
      },
      state: {
        control_mode: 'pointer',
        selected_node: {
          id: 'llm',
        },
      },
    })
  })

  it('should report graph issues that block reliable workflow construction', () => {
    const graph = summarizeWorkflowGraph({
      edges: [
        {
          id: 'edge-1',
          source: 'missing-source',
          target: 'lonely',
        },
      ] as Edge[],
      nodes: [
        {
          data: {
            desc: 'No entry',
            title: 'LLM',
            type: BlockEnum.LLM,
          },
          id: 'lonely',
          position: { x: 0, y: 0 },
          type: 'custom',
        },
      ] as Node[],
    })

    expect(graph).toMatchObject({
      error_count: 2,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'missing_entry_node' }),
        expect.objectContaining({ code: 'missing_terminal_node' }),
        expect.objectContaining({ code: 'dangling_edges' }),
      ]),
      node_type_counts: {
        [BlockEnum.LLM]: 1,
      },
      valid: false,
      warning_count: 1,
    })
  })

  it('should explain workflow construction primitives for agents', () => {
    const guide = getWorkflowConstructionGuide()

    expect(guide).toMatchObject({
      build_strategy: expect.any(Array),
      debug_cycle: expect.arrayContaining([
        'dify_search_marketplace_plugins',
        'dify_list_installed_plugin_capabilities',
        'dify_run_workflow_draft',
        'dify_get_workflow_run_node_executions',
        'dify_publish_workflow',
      ]),
      node_types: expect.objectContaining({
        control_flow: expect.any(Array),
        data_and_tools: expect.any(Array),
      }),
    })
  })
})
