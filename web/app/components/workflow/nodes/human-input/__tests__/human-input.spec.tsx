import type { HumanInputNodeType } from '@/app/components/workflow/nodes/human-input/types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vite-plus/test'
import humanInputDefault from '@/app/components/workflow/nodes/human-input/default'
import {
  DeliveryMethodType,
  UserActionButtonType,
} from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  initialNodes,
  preprocessNodesAndEdges,
} from '@/app/components/workflow/utils/workflow-init'
import { withSelectorKey } from '@/test/i18n-mock'

const createHumanInputNode = (overrides?: Partial<HumanInputNodeType>): Node => ({
  id: 'human-input-1',
  type: 'custom',
  position: { x: 400, y: 200 },
  data: {
    type: BlockEnum.HumanInput,
    title: 'Human Input',
    desc: 'Wait for human input',
    delivery_methods: [
      {
        id: 'dm-1',
        type: DeliveryMethodType.WebApp,
        enabled: true,
      },
      {
        id: 'dm-2',
        type: DeliveryMethodType.Email,
        enabled: true,
        config: {
          recipients: { whole_workspace: false, items: [] },
          subject: 'Please review',
          body: 'Please review {{#url#}}',
          debug_mode: false,
        },
      },
    ],
    form_content: '# Review Form\nPlease fill in the details below.',
    inputs: [
      {
        type: 'text-input',
        output_variable_name: 'review_result',
        default: { selector: [], type: 'constant' as const, value: '' },
      },
    ],
    user_actions: [
      {
        id: 'approve',
        title: 'Approve',
        button_style: UserActionButtonType.Primary,
      },
      {
        id: 'reject',
        title: 'Reject',
        button_style: UserActionButtonType.Default,
      },
    ],
    timeout: 3,
    timeout_unit: 'day' as const,
    ...overrides,
  } as HumanInputNodeType,
})

const createStartNode = (): Node => ({
  id: 'inset-s-1',
  type: 'custom',
  position: { x: 100, y: 200 },
  data: {
    type: BlockEnum.Start,
    title: 'Start',
    desc: '',
  } as Node['data'],
})

const createEdge = (
  source: string,
  target: string,
  sourceHandle = 'source',
  targetHandle = 'target',
): Edge =>
  ({
    id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
    type: 'custom',
    source,
    sourceHandle,
    target,
    targetHandle,
    data: {},
  }) as Edge

describe('DSL Import with Human Input Node', () => {
  describe('HumanInput Default Configuration', () => {
    it('should validate that delivery methods are required', () => {
      const t = withSelectorKey((key: string) => key, 'workflow')
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('nodes.humanInput.errorMsg.noDeliveryMethod')
    })

    it('should validate that at least one delivery method is enabled', () => {
      const t = withSelectorKey((key: string) => key, 'workflow')
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [{ id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: false }],
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
        ],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result).toEqual({
        isValid: false,
        errorMessage: 'nodes.humanInput.errorMsg.noDeliveryMethodEnabled',
      })
    })

    it('should validate that enabled email delivery methods have complete configuration', () => {
      const t = withSelectorKey((key: string) => key, 'workflow')
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [
          {
            id: 'dm-email',
            type: DeliveryMethodType.Email,
            enabled: true,
          },
        ],
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
        ],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('nodes.humanInput.errorMsg.emailConfigIncomplete')
    })

    it('should validate email delivery config fields before user actions', () => {
      const t = withSelectorKey((key: string) => key, 'workflow')
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [
          {
            id: 'dm-email',
            type: DeliveryMethodType.Email,
            enabled: true,
            config: {
              recipients: { whole_workspace: false, items: [] },
              subject: 'Review request',
              body: 'Please review {{#url#}}',
              debug_mode: false,
            },
          },
        ],
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
        ],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('nodes.humanInput.errorMsg.emailConfigIncomplete')
    })

    it('should validate enabled email subject and body content', () => {
      const t = withSelectorKey((key: string) => key, 'workflow')
      const createPayload = (body: string, subject = 'Review request') =>
        ({
          ...humanInputDefault.defaultValue,
          delivery_methods: [
            {
              id: 'dm-email',
              type: DeliveryMethodType.Email,
              enabled: true,
              config: {
                recipients: { whole_workspace: true, items: [] },
                subject,
                body,
                debug_mode: false,
              },
            },
          ],
          user_actions: [
            { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
          ],
        }) as HumanInputNodeType

      expect(humanInputDefault.checkValid(createPayload('{{#url#}}', '  '), t)).toEqual({
        isValid: false,
        errorMessage: 'nodes.humanInput.errorMsg.emailConfigIncomplete',
      })
      expect(humanInputDefault.checkValid(createPayload('Please review'), t)).toEqual({
        isValid: false,
        errorMessage: 'nodes.humanInput.errorMsg.emailConfigIncomplete',
      })
    })

    it('should validate that user actions are required', () => {
      const t = withSelectorKey((key: string) => key, 'workflow')
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [{ id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: true }],
        user_actions: [],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result).toEqual({
        isValid: false,
        errorMessage: 'nodes.humanInput.errorMsg.noUserActions',
      })
    })

    it('should validate that user action IDs are not duplicated', () => {
      const t = withSelectorKey((key: string) => key, 'workflow')
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [{ id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: true }],
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
          { id: 'approve', title: 'Also Approve', button_style: UserActionButtonType.Default },
        ],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result).toEqual({
        isValid: false,
        errorMessage: 'nodes.humanInput.errorMsg.duplicateActionId',
      })
    })

    it('should validate that user action ids and titles are not empty', () => {
      const t = withSelectorKey((key: string) => key, 'workflow')
      const createPayload = (userActions: HumanInputNodeType['user_actions']) =>
        ({
          ...humanInputDefault.defaultValue,
          delivery_methods: [{ id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: true }],
          user_actions: userActions,
        }) as HumanInputNodeType

      expect(
        humanInputDefault.checkValid(
          createPayload([
            { id: '  ', title: 'Approve', button_style: UserActionButtonType.Primary },
          ]),
          t,
        ),
      ).toEqual({
        isValid: false,
        errorMessage: 'nodes.humanInput.errorMsg.emptyActionId',
      })
      expect(
        humanInputDefault.checkValid(
          createPayload([
            { id: 'approve', title: '  ', button_style: UserActionButtonType.Primary },
          ]),
          t,
        ),
      ).toEqual({
        isValid: false,
        errorMessage: 'nodes.humanInput.errorMsg.emptyActionTitle',
      })
    })

    it('ignores incomplete email configuration when that delivery method is disabled', () => {
      const payload = createHumanInputNode({
        delivery_methods: [
          { id: 'web', type: DeliveryMethodType.WebApp, enabled: true },
          { id: 'email', type: DeliveryMethodType.Email, enabled: false },
        ],
      }).data as HumanInputNodeType
      expect(
        humanInputDefault.checkValid(
          payload,
          withSelectorKey((key: string) => key, 'workflow'),
        ),
      ).toEqual({
        isValid: true,
        errorMessage: '',
      })
    })

    it('should pass validation with correct configuration', () => {
      const t = withSelectorKey((key: string) => key, 'workflow')
      const payload = {
        ...humanInputDefault.defaultValue,
        delivery_methods: [{ id: 'dm-1', type: DeliveryMethodType.WebApp, enabled: true }],
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
          { id: 'reject', title: 'Reject', button_style: UserActionButtonType.Default },
        ],
      } as HumanInputNodeType

      const result = humanInputDefault.checkValid(payload, t)

      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBe('')
    })
  })

  describe('HumanInput Output Variables', () => {
    it('should generate output variables from form inputs', () => {
      const payload = {
        ...humanInputDefault.defaultValue,
        inputs: [
          {
            type: 'paragraph',
            output_variable_name: 'review_result',
            default: { selector: [], type: 'constant' as const, value: '' },
          },
          {
            type: 'file',
            output_variable_name: 'attachment',
            allowed_file_extensions: [],
            allowed_file_types: [],
            allowed_file_upload_methods: [],
          },
          {
            type: 'file-list',
            output_variable_name: 'attachments',
            allowed_file_extensions: [],
            allowed_file_types: [],
            allowed_file_upload_methods: [],
            number_limits: 3,
          },
          {
            type: 'select',
            output_variable_name: 'comment',
            option_source: { type: 'constant', selector: [], value: ['A', 'B'] },
          },
        ],
      } as HumanInputNodeType

      const outputVars = humanInputDefault.getOutputVars!(payload, {}, [])

      expect(outputVars).toEqual([
        { variable: 'review_result', type: 'string' },
        { variable: 'attachment', type: 'file' },
        { variable: 'attachments', type: 'array[file]' },
        { variable: 'comment', type: 'string' },
      ])
    })

    it('should return no output variables when no form inputs exist', () => {
      const payload = {
        ...humanInputDefault.defaultValue,
        inputs: [],
      } as HumanInputNodeType

      const outputVars = humanInputDefault.getOutputVars!(payload, {}, [])

      expect(outputVars).toEqual([])
    })
  })

  describe('Full Workflow with Human Input Node', () => {
    it('preserves imported configuration and connects action and timeout branches', () => {
      const startNode = createStartNode()
      const humanInputNode = createHumanInputNode()
      const approveEndNode: Node = {
        id: 'approve-end',
        type: 'custom',
        position: { x: 700, y: 100 },
        data: { type: BlockEnum.End, title: 'Approve End', desc: '', outputs: [] } as Node['data'],
      }
      const rejectEndNode: Node = {
        id: 'reject-end',
        type: 'custom',
        position: { x: 700, y: 300 },
        data: { type: BlockEnum.End, title: 'Reject End', desc: '', outputs: [] } as Node['data'],
      }

      const nodes = [startNode, humanInputNode, approveEndNode, rejectEndNode]
      const edges = [
        createEdge('inset-s-1', 'human-input-1'),
        createEdge('human-input-1', 'approve-end', 'approve', 'target'),
        createEdge('human-input-1', 'reject-end', 'reject', 'target'),
        createEdge('human-input-1', 'reject-end', '__timeout', 'target'),
      ]

      const originalData = structuredClone(humanInputNode.data)
      const processed = preprocessNodesAndEdges(nodes, edges)
      expect(processed.edges).toEqual(edges)
      const initialized = initialNodes(processed.nodes, processed.edges)
      expect(initialized.map((node) => node.id)).toEqual(nodes.map((node) => node.id))
      const hiNode = initialized.find((node) => node.id === 'human-input-1')!
      expect(hiNode.data).toMatchObject(originalData)
      expect(hiNode.data._connectedSourceHandleIds).toEqual(['approve', 'reject', '__timeout'])
      expect(hiNode.data._connectedTargetHandleIds).toEqual(['target'])
      expect(
        initialized.find((node) => node.id === 'approve-end')!.data._connectedTargetHandleIds,
      ).toEqual(['target'])
      expect(
        initialized.find((node) => node.id === 'reject-end')!.data._connectedTargetHandleIds,
      ).toEqual(['target', 'target'])
    })
  })
})
