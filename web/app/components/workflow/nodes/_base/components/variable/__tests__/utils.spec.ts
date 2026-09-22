import type { AgentV2NodeType } from '@/app/components/workflow/nodes/agent-v2/types'
import type { AgentNodeType } from '@/app/components/workflow/nodes/agent/types'
import type { AnswerNodeType } from '@/app/components/workflow/nodes/answer/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { HumanInputNodeType } from '@/app/components/workflow/nodes/human-input/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { EnvironmentVariable, Node, PromptItem } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vite-plus/test'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { DeliveryMethodType } from '@/app/components/workflow/nodes/human-input/types'
import {
  BlockEnum,
  EditionType,
  InputVarType,
  PromptRole,
  VarType,
} from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import { getNodeUsedVars, toNodeAvailableVars, updateNodeVars } from '../utils'

const createNode = <T>(data: Node<T>['data']): Node<T> => ({
  id: 'node-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data,
})

const createPromptItem = (overrides: Partial<PromptItem> = {}): PromptItem => ({
  role: PromptRole.user,
  text: '',
  ...overrides,
})

const createLLMNodeData = (promptTemplate: PromptItem[]): LLMNodeType => ({
  type: BlockEnum.LLM,
  title: 'LLM',
  desc: '',
  model: {
    provider: 'provider',
    name: 'model',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  },
  prompt_template: promptTemplate,
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
})

describe('variable utils', () => {
  describe('toNodeAvailableVars', () => {
    it('excludes LLM environment aliases from generic variable pickers', () => {
      const environmentVariables: EnvironmentVariable[] = [
        {
          id: 'text-env',
          name: 'query',
          value: 'hello',
          value_type: 'string',
          description: '',
        },
        {
          id: 'llm-env',
          name: 'shared_model',
          value: { provider: 'provider', name: 'model', mode: 'chat' },
          value_type: 'llm',
          description: '',
        },
      ]

      const availableVars = toNodeAvailableVars({
        beforeNodes: [],
        isChatMode: false,
        environmentVariables,
        filterVar: () => true,
        allPluginInfoList: {},
      })

      expect(availableVars.find((item) => item.nodeId === 'env')?.vars).toEqual([
        expect.objectContaining({ variable: 'env.query', type: 'string' }),
      ])
    })

    it.each([null, undefined])(
      'keeps the built-in legacy Agent outputs without an output schema: %s',
      (output_schema) => {
        const node = createNode<AgentNodeType>({
          type: BlockEnum.Agent,
          title: 'Agent',
          desc: '',
          output_schema,
        })
        const availableVars = toNodeAvailableVars({
          beforeNodes: [node],
          isChatMode: false,
          filterVar: () => true,
          allPluginInfoList: {},
        })
        expect(availableVars.find((item) => item.nodeId === node.id)?.vars).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ variable: 'text', type: VarType.string }),
            expect.objectContaining({ variable: 'json', type: VarType.arrayObject }),
          ]),
        )
      },
    )

    it('keeps legacy Agent JSON Schema outputs selectable with canonical variable types', () => {
      const node = createNode<AgentNodeType>({
        type: BlockEnum.Agent,
        title: 'Agent',
        desc: '',
        output_schema: {
          properties: {
            answer: { type: 'string' },
            scores: { type: 'array', items: { type: 'number' } },
            allowed: true,
            forbidden: false,
            unspecified: {},
            emptyType: { type: '' },
          },
        },
      })
      const options = { beforeNodes: [node], isChatMode: false, allPluginInfoList: {} }
      const availableVars = toNodeAvailableVars({ ...options, filterVar: () => true })
      expect(availableVars.find((item) => item.nodeId === node.id)?.vars).toEqual(
        expect.arrayContaining([
          { variable: 'answer', type: VarType.string },
          { variable: 'scores', type: VarType.arrayNumber },
          { variable: 'allowed', type: VarType.any },
          { variable: 'forbidden', type: VarType.any },
          { variable: 'unspecified', type: VarType.any },
          { variable: 'emptyType', type: VarType.any },
        ]),
      )
      const stringVars = toNodeAvailableVars({
        ...options,
        filterVar: (variable) => variable.type === VarType.string,
      })
      expect(stringVars.find((item) => item.nodeId === node.id)?.vars).toContainEqual({
        variable: 'answer',
        type: VarType.string,
      })
      expect(stringVars.find((item) => item.nodeId === node.id)?.vars).not.toContainEqual(
        expect.objectContaining({ variable: 'scores' }),
      )
    })

    it('uses Agent v2 default declared outputs for agent nodes', () => {
      const node = createNode<AgentV2NodeType>({
        type: BlockEnum.Agent,
        title: 'Agent',
        desc: '',
        agent_node_kind: 'dify_agent',
        version: '2',
      })

      const availableVars = toNodeAvailableVars({
        beforeNodes: [node],
        isChatMode: false,
        filterVar: () => true,
        allPluginInfoList: {},
      })

      expect(availableVars).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeId: 'node-1',
            vars: [{ variable: 'text', type: VarType.string }],
          }),
        ]),
      )
      expect(availableVars.find((item) => item.nodeId === 'node-1')?.vars).not.toContainEqual({
        variable: 'usage',
        type: VarType.object,
      })
    })

    it('uses Agent v2 declared outputs from graph data', () => {
      const node = createNode<AgentV2NodeType>({
        type: BlockEnum.AgentV2,
        title: 'Agent',
        desc: '',
        agent_node_kind: 'dify_agent',
        agent_declared_outputs: [
          {
            name: 'summary',
            type: 'string',
            description: 'Short summary',
          },
          {
            name: 'attachments',
            type: 'array',
            array_item: {
              type: 'file',
            },
          },
        ],
        version: '2',
      })

      const availableVars = toNodeAvailableVars({
        beforeNodes: [node],
        isChatMode: false,
        filterVar: () => true,
        allPluginInfoList: {},
      })

      expect(availableVars).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeId: 'node-1',
            vars: [
              { variable: 'text', type: VarType.string },
              { variable: 'summary', type: VarType.string },
              { variable: 'attachments', type: VarType.arrayFile },
            ],
          }),
        ]),
      )
    })
  })

  describe('getNodeUsedVars', () => {
    it('should read variables from llm jinja prompt text', () => {
      const node = createNode<LLMNodeType>(
        createLLMNodeData([
          createPromptItem({
            edition_type: EditionType.jinja2,
            jinja2_text: 'Hello {{#env.API_KEY#}}',
          }),
        ]),
      )

      expect(getNodeUsedVars(node)).toContainEqual(['env', 'API_KEY'])
    })

    it('should read an LLM model environment selector', () => {
      const node = createNode<LLMNodeType>({
        ...createLLMNodeData([]),
        model_selector: ['env', 'for_summarize'],
      })

      expect(getNodeUsedVars(node)).toContainEqual(['env', 'for_summarize'])
    })

    it('should read variables from human input email body', () => {
      const node = createNode<HumanInputNodeType>({
        type: BlockEnum.HumanInput,
        title: 'Human Input',
        desc: '',
        form_content: '',
        inputs: [
          {
            type: InputVarType.paragraph,
            output_variable_name: 'summary',
            default: {
              type: 'variable',
              selector: ['conversation', 'memory'],
              value: '',
            },
          },
          {
            type: InputVarType.select,
            output_variable_name: 'decision',
            option_source: {
              type: 'variable',
              selector: ['env', 'OPTIONS'],
              value: [],
            },
          },
        ],
        user_actions: [],
        timeout: 1,
        timeout_unit: 'day',
        delivery_methods: [
          {
            id: 'email',
            type: DeliveryMethodType.Email,
            enabled: true,
            config: {
              recipients: { whole_workspace: true, items: [] },
              subject: 'Subject {{#conversation.memory#}}',
              body: 'Body {{#env.API_KEY#}}',
              debug_mode: false,
            },
          },
        ],
      })

      expect(getNodeUsedVars(node)).toEqual(
        expect.arrayContaining([
          ['env', 'API_KEY'],
          ['conversation', 'memory'],
          ['env', 'OPTIONS'],
        ]),
      )
    })

    it('should read variables from agent task', () => {
      const node = createNode<AgentV2NodeType>({
        type: BlockEnum.Agent,
        title: 'Agent',
        desc: '',
        agent_node_kind: 'dify_agent',
        agent_task: 'Clarify {{#start.tender#}}',
        version: '2',
      })

      expect(getNodeUsedVars(node)).toContainEqual(['start', 'tender'])
    })
  })

  describe('updateNodeVars', () => {
    it('should replace answer prompt references', () => {
      const node = createNode<AnswerNodeType>({
        type: BlockEnum.Answer,
        title: 'Answer',
        desc: '',
        answer: 'Answer {{#env.API_KEY#}}',
        variables: [],
      })

      const updatedNode = updateNodeVars(node, ['env', 'API_KEY'], ['env', 'RENAMED_KEY'])

      expect((updatedNode.data as AnswerNodeType).answer).toBe('Answer {{#env.RENAMED_KEY#}}')
    })

    it('should replace llm jinja prompt references', () => {
      const node = createNode<LLMNodeType>(
        createLLMNodeData([
          createPromptItem({
            text: '{{#env.API_KEY#}}',
            edition_type: EditionType.jinja2,
            jinja2_text: 'Hello {{#env.API_KEY#}}',
          }),
        ]),
      )

      const updatedNode = updateNodeVars(node, ['env', 'API_KEY'], ['env', 'RENAMED_KEY'])

      expect(((updatedNode.data as LLMNodeType).prompt_template as PromptItem[])[0]).toMatchObject({
        text: '{{#env.RENAMED_KEY#}}',
        jinja2_text: 'Hello {{#env.RENAMED_KEY#}}',
      })
    })

    it('should replace an LLM model environment selector', () => {
      const node = createNode<LLMNodeType>({
        ...createLLMNodeData([]),
        model_selector: ['env', 'for_summarize'],
      })

      const updatedNode = updateNodeVars(node, ['env', 'for_summarize'], ['env', 'for_research'])

      expect((updatedNode.data as LLMNodeType).model_selector).toEqual(['env', 'for_research'])
    })

    it('should replace agent task references', () => {
      const node = createNode<AgentV2NodeType>({
        type: BlockEnum.Agent,
        title: 'Agent',
        desc: '',
        agent_node_kind: 'dify_agent',
        agent_task: 'Clarify {{#start.tender#}}',
        version: '2',
      })

      const updatedNode = updateNodeVars(node, ['start', 'tender'], ['start', 'question'])

      expect((updatedNode.data as AgentV2NodeType).agent_task).toBe('Clarify {{#start.question#}}')
    })

    it('should replace human input email template references', () => {
      const node = createNode<HumanInputNodeType>({
        type: BlockEnum.HumanInput,
        title: 'Human Input',
        desc: '',
        form_content: '',
        inputs: [
          {
            type: InputVarType.paragraph,
            output_variable_name: 'summary',
            default: {
              type: 'variable',
              selector: ['env', 'API_KEY'],
              value: '',
            },
          },
          {
            type: InputVarType.select,
            output_variable_name: 'decision',
            option_source: {
              type: 'variable',
              selector: ['env', 'API_KEY'],
              value: [],
            },
          },
        ],
        user_actions: [],
        timeout: 1,
        timeout_unit: 'day',
        delivery_methods: [
          {
            id: 'email',
            type: DeliveryMethodType.Email,
            enabled: true,
            config: {
              recipients: { whole_workspace: true, items: [] },
              subject: 'Subject {{#conversation.memory#}}',
              body: 'Body {{#env.API_KEY#}}',
              debug_mode: false,
            },
          },
        ],
      })

      const updatedNode = updateNodeVars(node, ['env', 'API_KEY'], ['env', 'RENAMED_KEY'])

      expect((updatedNode.data as HumanInputNodeType).delivery_methods[0]?.config).toMatchObject({
        subject: 'Subject {{#conversation.memory#}}',
        body: 'Body {{#env.RENAMED_KEY#}}',
      })
      expect((updatedNode.data as HumanInputNodeType).inputs[0]).toMatchObject({
        default: {
          selector: ['env', 'RENAMED_KEY'],
        },
      })
      expect((updatedNode.data as HumanInputNodeType).inputs[1]).toMatchObject({
        option_source: {
          selector: ['env', 'RENAMED_KEY'],
        },
      })
    })
  })
})

it('keeps datasource output variables typed through the public picker projection', () => {
  const provider = createDatasourceProvider()
  provider.declaration.datasources![0]!.output_schema = {
    properties: {
      title: { type: 'string' },
      count: { type: 'integer' },
      names: { type: 'array', items: { type: 'string' } },
      metadata: {
        type: 'object',
        properties: { summary: { type: 'string' }, enabled: { type: 'boolean' } },
      },
      unrestricted: true,
      forbidden: false,
      unknown: null,
    },
  }
  const node = createNode<DataSourceNodeType>({
    type: BlockEnum.DataSource,
    title: 'Datasource',
    desc: '',
    plugin_id: provider.plugin_id,
    provider_name: provider.provider,
    provider_type: 'local_file',
    datasource_name: 'local-file',
    datasource_label: 'Local file',
    datasource_parameters: {},
    datasource_configurations: {},
  })
  const options = {
    beforeNodes: [node],
    isChatMode: false,
    allPluginInfoList: { dataSourceList: [provider] },
  }
  const all = toNodeAvailableVars({ ...options, filterVar: () => true }).find(
    (item) => item.nodeId === node.id,
  )?.vars
  expect(all).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ variable: 'file', type: VarType.file }),
      expect.objectContaining({ variable: 'title', type: VarType.string }),
      expect.objectContaining({ variable: 'count', type: VarType.integer }),
      expect.objectContaining({ variable: 'names', type: VarType.arrayString }),
      expect.objectContaining({ variable: 'unrestricted', type: VarType.any }),
      expect.objectContaining({ variable: 'forbidden', type: VarType.any }),
      expect.objectContaining({ variable: 'unknown', type: VarType.any }),
    ]),
  )
  const strings = toNodeAvailableVars({
    ...options,
    filterVar: (variable) => variable.type === VarType.string,
  }).find((item) => item.nodeId === node.id)?.vars
  expect(strings?.find((variable) => variable.variable === 'metadata')?.children).toEqual([
    expect.objectContaining({ variable: 'summary', type: VarType.string }),
  ])
  expect(strings?.find((variable) => variable.variable === 'unrestricted')).toBeUndefined()
})
