import type { AnswerNodeType } from '@/app/components/workflow/nodes/answer/types'
import type { HumanInputNodeType } from '@/app/components/workflow/nodes/human-input/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { Node, PromptItem } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vitest'
import { DeliveryMethodType } from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum, EditionType, PromptRole } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import { getNodeUsedVars, updateNodeVars } from '../utils'

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
        inputs: [],
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
        ]),
      )
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

    it('should replace human input email template references', () => {
      const node = createNode<HumanInputNodeType>({
        type: BlockEnum.HumanInput,
        title: 'Human Input',
        desc: '',
        form_content: '',
        inputs: [],
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
    })
  })
})
