import type { AgentV2NodeType } from '@/app/components/workflow/nodes/agent-v2/types'
import type { AnswerNodeType } from '@/app/components/workflow/nodes/answer/types'
import type { HumanInputV2NodeType } from '@/app/components/workflow/nodes/human-input-v2/types'
import type { HumanInputNodeType } from '@/app/components/workflow/nodes/human-input/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { Node, PromptItem } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vitest'
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
    it('exposes shared form and action outputs for Human Input v2', () => {
      const node = createNode<HumanInputV2NodeType>({
        type: BlockEnum.HumanInput,
        version: '2',
        title: 'Human Input v2',
        desc: '',
        recpients_spec: [{ type: 'initiator' }],
        message_template: { subject: 'Review', body: 'Body' },
        debug_mode: { enabled: false, channels: [] },
        form_content: '',
        inputs: [
          {
            type: InputVarType.paragraph,
            output_variable_name: 'review_note',
            default: { type: 'constant', selector: [], value: '' },
          },
        ],
        user_actions: [],
        timeout: 36,
        timeout_unit: 'hour',
      })

      const availableVars = toNodeAvailableVars({
        beforeNodes: [node],
        isChatMode: false,
        filterVar: () => true,
        allPluginInfoList: {},
      })

      expect(availableVars.find((item) => item.nodeId === 'node-1')?.vars).toEqual([
        { variable: 'review_note', type: VarType.string },
        { variable: '__action_id', type: VarType.string },
        { variable: '__action_value', type: VarType.string },
        { variable: '__rendered_content', type: VarType.string },
      ])
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
            vars: [
              { variable: 'text', type: VarType.string },
              { variable: 'files', type: VarType.arrayFile },
              { variable: 'json', type: VarType.object },
            ],
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
              { variable: 'summary', type: VarType.string },
              { variable: 'attachments', type: VarType.arrayFile },
            ],
          }),
        ]),
      )
      expect(availableVars.find((item) => item.nodeId === 'node-1')?.vars).not.toContainEqual({
        variable: 'text',
        type: VarType.string,
      })
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

    it('reads Human Input v2 recipient, template, form and input dependencies', () => {
      const node = createNode<HumanInputV2NodeType>({
        type: BlockEnum.HumanInput,
        version: '2',
        title: 'Human Input v2',
        desc: '',
        recpients_spec: [
          { type: 'dynamic_email', selector: ['start', 'recipient_email'] },
          { type: 'initiator' },
        ],
        message_template: {
          subject: 'Review {{#conversation.topic#}}',
          body: 'Body {{#env.TEMPLATE#}}',
        },
        debug_mode: { enabled: false, channels: [] },
        form_content: 'Form {{#start.request#}}',
        inputs: [
          {
            type: InputVarType.paragraph,
            output_variable_name: 'comment',
            default: { type: 'variable', selector: ['env', 'DEFAULT_COMMENT'], value: '' },
          },
        ],
        user_actions: [],
        timeout: 36,
        timeout_unit: 'hour',
      })

      expect(getNodeUsedVars(node)).toEqual(
        expect.arrayContaining([
          ['start', 'recipient_email'],
          ['conversation', 'topic'],
          ['env', 'TEMPLATE'],
          ['start', 'request'],
          ['env', 'DEFAULT_COMMENT'],
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

    it('renames Human Input v2 references without adding v1 delivery methods', () => {
      const node = createNode<HumanInputV2NodeType>({
        type: BlockEnum.HumanInput,
        version: '2',
        title: 'Human Input v2',
        desc: '',
        recpients_spec: [{ type: 'dynamic_email', selector: ['start', 'email'] }],
        message_template: {
          subject: 'Subject {{#start.email#}}',
          body: 'Body {{#start.email#}}',
        },
        debug_mode: { enabled: true, channels: ['email'] },
        form_content: 'Form {{#start.email#}}',
        inputs: [],
        user_actions: [],
        timeout: 36,
        timeout_unit: 'hour',
      })

      const updatedNode = updateNodeVars(node, ['start', 'email'], ['start', 'owner_email'])
      const data = updatedNode.data as HumanInputV2NodeType

      expect(data.recpients_spec).toEqual([
        { type: 'dynamic_email', selector: ['start', 'owner_email'] },
      ])
      expect(data.message_template).toEqual({
        subject: 'Subject {{#start.owner_email#}}',
        body: 'Body {{#start.owner_email#}}',
      })
      expect(data.form_content).toBe('Form {{#start.owner_email#}}')
      expect(data).not.toHaveProperty('delivery_methods')
    })
  })
})
