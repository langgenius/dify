import type { HumanInputNodeType } from '../../../human-input/types'
import type { HumanInputV2NodeType } from '../../types'
import type { HumanInputMigrationResolverSnapshot } from '../types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { DeliveryMethodType } from '../../../human-input/types'
import { applyHumanInputV2MigrationPlan, createHumanInputV2MigrationPlan } from '../planner'
import { HumanInputMigrationBlockerCode } from '../types'

const snapshot: HumanInputMigrationResolverSnapshot = {
  members: [
    { id: 'member-a', email: 'evan@example.com' },
    { id: 'member-b', email: 'fallback@example.com' },
  ],
  contacts: [
    { id: 'contact-a', email: 'evan@example.com' },
    { id: 'contact-external', email: 'external@example.com' },
  ],
}

const createLegacyNode = (
  overrides: Partial<HumanInputNodeType & { version: unknown }> = {},
): Node => ({
  id: 'human-input-1',
  type: 'custom',
  position: { x: 120, y: 240 },
  width: 320,
  height: 180,
  data: {
    type: BlockEnum.HumanInput,
    title: 'Approval',
    desc: 'Preserve this',
    delivery_methods: [{ id: 'web', type: DeliveryMethodType.WebApp, enabled: true }],
    form_content: '{{#source.value#}}',
    inputs: [],
    user_actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
    timeout: 3,
    timeout_unit: 'day',
    _targetBranches: [{ id: 'approve', name: 'Approve' }],
    extension_field: { stable: true },
    ...overrides,
  } as unknown as HumanInputNodeType,
})

const edge: Edge = {
  id: 'human-input-1-approve-end-1-target',
  source: 'human-input-1',
  sourceHandle: 'approve',
  target: 'end-1',
  targetHandle: 'target',
  data: { sourceType: BlockEnum.HumanInput, targetType: BlockEnum.End },
}

describe('Human Input v2 migration planner', () => {
  it('preserves graph identity, topology, shared fields, extensions, branches, and references', () => {
    const graph = { nodes: [createLegacyNode()], edges: [edge] }
    const plan = createHumanInputV2MigrationPlan(graph, snapshot)

    expect(plan.status).toBe('ready')
    if (plan.status !== 'ready') return
    const migrated = applyHumanInputV2MigrationPlan(graph, plan)
    const migratedNode = migrated.nodes[0]!

    expect(migratedNode).toMatchObject({
      id: 'human-input-1',
      position: { x: 120, y: 240 },
      width: 320,
      height: 180,
    })
    expect(migratedNode.data).toMatchObject({
      type: BlockEnum.HumanInput,
      version: '2',
      title: 'Approval',
      desc: 'Preserve this',
      form_content: '{{#source.value#}}',
      timeout: 3,
      timeout_unit: 'day',
      _targetBranches: [{ id: 'approve', name: 'Approve' }],
      extension_field: { stable: true },
    })
    expect(migratedNode.data).not.toHaveProperty('delivery_methods')
    expect(migrated.edges).toBe(graph.edges)
    expect(migrated.edges[0]).toEqual(edge)
  })

  it('maps WebApp, member/contact fallback, external recipients, template, and debug mode', () => {
    const node = createLegacyNode({
      delivery_methods: [
        { id: 'web', type: DeliveryMethodType.WebApp, enabled: true },
        {
          id: 'email',
          type: DeliveryMethodType.Email,
          enabled: true,
          config: {
            recipients: {
              whole_workspace: false,
              items: [
                { type: 'member', user_id: 'member-a' },
                { type: 'member', user_id: 'member-b' },
                { type: 'external', email: '  external@example.com  ' },
              ],
            },
            subject: '  Review {{#source.value#}}  ',
            body: '\nKeep whitespace {{#url#}}\n',
            debug_mode: true,
          },
        },
      ],
    })

    const plan = createHumanInputV2MigrationPlan({ nodes: [node], edges: [] }, snapshot)
    expect(plan.status).toBe('ready')
    if (plan.status !== 'ready') return
    const data = plan.replacements[0]!.data
    expect(data.recipients_spec).toEqual([
      { type: 'initiator' },
      { type: 'contact', contact_id: 'contact-a' },
      { type: 'onetime_email', email: 'fallback@example.com' },
      { type: 'contact', contact_id: 'contact-external' },
    ])
    expect(data.message_template).toEqual({
      subject: '  Review {{#source.value#}}  ',
      body: '\nKeep whitespace {{#url#}}\n',
    })
    expect(data.debug_mode).toEqual({ enabled: true, channels: ['email'] })
  })

  it('expands one stable whole-workspace snapshot and deduplicates in first-occurrence order', () => {
    const node = createLegacyNode({
      delivery_methods: [
        { id: 'web-a', type: DeliveryMethodType.WebApp, enabled: true },
        { id: 'web-b', type: DeliveryMethodType.WebApp, enabled: true },
        {
          id: 'email',
          type: DeliveryMethodType.Email,
          enabled: true,
          config: {
            recipients: {
              whole_workspace: true,
              items: [
                { type: 'external', email: 'EVAN@example.com' },
                { type: 'external', email: 'first@example.com' },
              ],
            },
            subject: 'Subject',
            body: 'Body',
            debug_mode: false,
          },
        },
      ],
    })

    const plan = createHumanInputV2MigrationPlan({ nodes: [node], edges: [] }, snapshot)
    expect(plan.status).toBe('ready')
    if (plan.status !== 'ready') return
    expect(plan.replacements[0]!.data.recipients_spec).toEqual([
      { type: 'initiator' },
      { type: 'contact', contact_id: 'contact-a' },
      { type: 'onetime_email', email: 'first@example.com' },
      { type: 'onetime_email', email: 'fallback@example.com' },
    ])
  })

  it.each([
    [
      'numeric version',
      createLegacyNode({ version: 2 }),
      HumanInputMigrationBlockerCode.UnsupportedVersion,
    ],
    [
      'unknown version',
      createLegacyNode({ version: '3' }),
      HumanInputMigrationBlockerCode.UnsupportedVersion,
    ],
    [
      'configured disabled method',
      createLegacyNode({
        delivery_methods: [
          {
            id: 'email',
            type: DeliveryMethodType.Email,
            enabled: false,
            config: {
              recipients: {
                whole_workspace: false,
                items: [{ type: 'external', email: 'a@example.com' }],
              },
              subject: 'Subject',
              body: 'Body',
              debug_mode: false,
            },
          },
        ],
      }),
      HumanInputMigrationBlockerCode.ConfiguredDisabledMethod,
    ],
    [
      'unsupported method',
      createLegacyNode({
        delivery_methods: [{ id: 'slack', type: DeliveryMethodType.Slack, enabled: true }],
      }),
      HumanInputMigrationBlockerCode.UnsupportedDeliveryMethod,
    ],
    [
      'invalid email',
      createLegacyNode({
        delivery_methods: [
          {
            id: 'email',
            type: DeliveryMethodType.Email,
            enabled: true,
            config: {
              recipients: {
                whole_workspace: false,
                items: [{ type: 'external', email: 'invalid' }],
              },
              subject: 'Subject',
              body: 'Body',
              debug_mode: false,
            },
          },
        ],
      }),
      HumanInputMigrationBlockerCode.InvalidEmail,
    ],
    [
      'invalid email configuration',
      createLegacyNode({
        delivery_methods: [
          {
            id: 'email',
            type: DeliveryMethodType.Email,
            enabled: true,
            config: {
              recipients: {
                whole_workspace: false,
                items: [{ type: 'external', email: 'a@example.com' }],
              },
              subject: '   ',
              body: 'Body',
              debug_mode: false,
            },
          },
        ],
      }),
      HumanInputMigrationBlockerCode.InvalidEmailConfiguration,
    ],
    [
      'unresolved member',
      createLegacyNode({
        delivery_methods: [
          {
            id: 'email',
            type: DeliveryMethodType.Email,
            enabled: true,
            config: {
              recipients: {
                whole_workspace: false,
                items: [{ type: 'member', user_id: 'missing' }],
              },
              subject: 'Subject',
              body: 'Body',
              debug_mode: false,
            },
          },
        ],
      }),
      HumanInputMigrationBlockerCode.UnresolvedMember,
    ],
    [
      'conflicting templates',
      createLegacyNode({
        delivery_methods: [
          {
            id: 'email-a',
            type: DeliveryMethodType.Email,
            enabled: true,
            config: {
              recipients: {
                whole_workspace: false,
                items: [{ type: 'external', email: 'a@example.com' }],
              },
              subject: 'A',
              body: 'Body',
              debug_mode: false,
            },
          },
          {
            id: 'email-b',
            type: DeliveryMethodType.Email,
            enabled: true,
            config: {
              recipients: {
                whole_workspace: false,
                items: [{ type: 'external', email: 'b@example.com' }],
              },
              subject: 'B',
              body: 'Body',
              debug_mode: false,
            },
          },
        ],
      }),
      HumanInputMigrationBlockerCode.ConflictingEmailTemplates,
    ],
    [
      'missing recipients',
      createLegacyNode({ delivery_methods: [] }),
      HumanInputMigrationBlockerCode.MissingRecipients,
    ],
  ])('blocks %s without producing replacements', (_name, node, code) => {
    const plan = createHumanInputV2MigrationPlan({ nodes: [node], edges: [] }, snapshot)
    expect(plan.status).toBe('blocked')
    if (plan.status !== 'blocked') return
    expect(plan.blockers.some((blocker) => blocker.code === code)).toBe(true)
    expect(node.data).toHaveProperty('delivery_methods')
    expect(node.data).not.toHaveProperty('recipients_spec')
  })

  it('is idempotent for existing v2 nodes and preflights the entire batch before replacement', () => {
    const v2 = {
      ...createLegacyNode(),
      id: 'v2',
      data: {
        ...createLegacyNode().data,
        version: '2',
        recipients_spec: [{ type: 'initiator' }],
        message_template: { subject: '', body: '' },
        debug_mode: { enabled: false, channels: [] },
      } as unknown as HumanInputV2NodeType,
    }
    delete (v2.data as unknown as Record<string, unknown>).delivery_methods
    const eligible = createLegacyNode()
    const invalid = createLegacyNode({
      delivery_methods: [{ id: 'teams', type: DeliveryMethodType.Teams, enabled: true }],
    })
    invalid.id = 'invalid'

    const noOp = createHumanInputV2MigrationPlan({ nodes: [v2], edges: [] }, snapshot)
    expect(noOp).toEqual({ status: 'ready', replacements: [] })

    const blocked = createHumanInputV2MigrationPlan(
      { nodes: [v2, eligible, invalid], edges: [] },
      snapshot,
    )
    expect(blocked.status).toBe('blocked')
    expect(v2.data.version).toBe('2')
    expect(eligible.data).toHaveProperty('delivery_methods')
  })
})
