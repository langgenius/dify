import type { HumanInputV2NodeType } from '../types'
import { BlockEnum } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import { UserActionButtonType } from '../../human-input/shared/types'
import humanInputV2Default from '../default'

const createPayload = (overrides: Partial<HumanInputV2NodeType> = {}): HumanInputV2NodeType =>
  ({
    title: 'Human Input v2',
    desc: '',
    type: BlockEnum.HumanInput,
    ...humanInputV2Default.defaultValue,
    ...overrides,
  }) as HumanInputV2NodeType

describe('Human Input v2 default', () => {
  it('uses the complete frontend wire shape', () => {
    expect(humanInputV2Default.metaData.type).toBe(BlockEnum.HumanInputV2)
    expect(humanInputV2Default.defaultValue).toEqual({
      type: BlockEnum.HumanInput,
      version: '2',
      recipients_spec: [],
      message_template: { subject: '', body: '' },
      debug_mode: { enabled: false, channels: [] },
      form_content: '',
      inputs: [],
      user_actions: [],
      timeout: 36,
      timeout_unit: 'hour',
    })
  })

  it('preserves the recipients key and nested values through a JSON round trip', () => {
    const payload = createPayload({
      recipients_spec: [
        { type: 'initiator' },
        { type: 'contact', contact_id: 'contact-1' },
        { type: 'dynamic_email', selector: ['start', 'email'] },
        { type: 'onetime_email', email: 'owner@example.com' },
      ],
      message_template: { subject: 'Review', body: 'Please review {{#start.email#}}' },
      debug_mode: { enabled: true, channels: ['email', 'slack'] },
    })

    const roundTripped = JSON.parse(JSON.stringify(payload)) as HumanInputV2NodeType

    expect(roundTripped.type).toBe(BlockEnum.HumanInput)
    expect(roundTripped.version).toBe('2')
    expect(roundTripped.recipients_spec).toEqual(payload.recipients_spec)
    expect(roundTripped.message_template).toEqual(payload.message_template)
    expect(roundTripped.debug_mode).toEqual(payload.debug_mode)
  })

  it('rejects an empty configuration without requiring a v1 delivery method', () => {
    const result = humanInputV2Default.checkValid(
      createPayload(),
      withSelectorKey((key: string) => key, 'workflow'),
    )

    expect(result.isValid).toBe(false)
    expect(result.errorMessage).toBe('nodes.humanInputV2.error.recipientRequired')
    expect(createPayload()).not.toHaveProperty('delivery_methods')
  })

  it('accepts a complete template without the v1 request URL token', () => {
    const result = humanInputV2Default.checkValid(
      createPayload({
        recipients_spec: [{ type: 'initiator' }],
        message_template: { subject: 'Review request', body: 'Please review this request' },
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
        ],
      }),
      withSelectorKey((key: string) => key, 'workflow'),
    )

    expect(result).toEqual({ isValid: true, errorMessage: '' })
  })

  it('validates duplicate recipients and enabled Debug Mode channels', () => {
    const t = withSelectorKey((key: string) => key, 'workflow')
    const complete = {
      recipients_spec: [{ type: 'initiator' }] as HumanInputV2NodeType['recipients_spec'],
      message_template: { subject: 'Review', body: 'Body' },
      user_actions: [
        { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
      ],
    }

    expect(
      humanInputV2Default.checkValid(
        createPayload({
          ...complete,
          recipients_spec: [{ type: 'initiator' }, { type: 'initiator' }],
        }),
        t,
      ).errorMessage,
    ).toBe('nodes.humanInputV2.error.recipientDuplicate')
    expect(
      humanInputV2Default.checkValid(
        createPayload({ ...complete, debug_mode: { enabled: true, channels: [] } }),
        t,
      ).errorMessage,
    ).toBe('nodes.humanInputV2.error.debugChannelRequired')
  })
})
