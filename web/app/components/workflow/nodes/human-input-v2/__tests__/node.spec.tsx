import type { HumanInputV2NodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { UserActionButtonType } from '../../human-input/shared/types'
import { HumanInputV2Node } from '../node'

vi.mock('../../_base/components/node-handle', () => ({
  NodeSourceHandle: (props: { handleId: string }) => <div>{`handle:${props.handleId}`}</div>,
}))

const createData = (overrides: Partial<HumanInputV2NodeType> = {}): HumanInputV2NodeType => ({
  title: 'Human Input v2',
  desc: '',
  type: BlockEnum.HumanInput,
  version: '2',
  recipients_spec: [],
  message_template: { subject: '', body: '' },
  debug_mode: { enabled: false, channels: [] },
  form_content: '',
  inputs: [],
  user_actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
  timeout: 36,
  timeout_unit: 'hour',
  ...overrides,
})

describe('Human Input v2 node card', () => {
  it('renders the empty recipient warning and shared branch handles', () => {
    render(<HumanInputV2Node id="human-input-v2" data={createData()} />)

    expect(screen.getByText('workflow.nodes.humanInputV2.card.empty')).toBeInTheDocument()
    expect(screen.getByText('approve')).toBeInTheDocument()
    expect(screen.getByText('handle:approve')).toBeInTheDocument()
    expect(screen.getByText('handle:__timeout')).toBeInTheDocument()
  })

  it('renders initiator-only, contacts-only and mixed Figma summaries', async () => {
    const { rerender } = render(
      <HumanInputV2Node
        id="human-input-v2"
        data={createData({ recipients_spec: [{ type: 'initiator' }] })}
      />,
    )
    expect(screen.getByText('workflow.nodes.humanInputV2.card.initiatorOnly')).toBeInTheDocument()

    rerender(
      <HumanInputV2Node
        id="human-input-v2"
        data={createData({
          recipients_spec: [{ type: 'contact', contact_id: 'contact-evan' }],
        })}
      />,
    )
    expect(
      await screen.findByText((text) =>
        text.includes('workflow.nodes.humanInputV2.card.contactsOnly'),
      ),
    ).toBeInTheDocument()

    rerender(
      <HumanInputV2Node
        id="human-input-v2"
        data={createData({
          recipients_spec: [{ type: 'initiator' }, { type: 'contact', contact_id: 'contact-evan' }],
        })}
      />,
    )
    expect(
      await screen.findByText((text) =>
        text.includes('workflow.nodes.humanInputV2.card.initiatorAndContacts'),
      ),
    ).toBeInTheDocument()
  })

  it('renders deterministic overflow and unresolved states', () => {
    const { rerender } = render(
      <HumanInputV2Node
        id="human-input-v2"
        data={createData({
          recipients_spec: [
            { type: 'onetime_email', email: 'one@example.com' },
            { type: 'onetime_email', email: 'two@example.com' },
            { type: 'onetime_email', email: 'three@example.com' },
            { type: 'onetime_email', email: 'four@example.com' },
          ],
        })}
      />,
    )
    expect(
      screen.getByText((text) => text.includes('workflow.nodes.humanInputV2.card.configured')),
    ).toBeInTheDocument()

    rerender(
      <HumanInputV2Node
        id="human-input-v2"
        data={createData({ recipients_spec: [{ type: 'contact', contact_id: 'unresolved' }] })}
      />,
    )
    expect(screen.getByText('workflow.nodes.humanInputV2.card.invalid')).toBeInTheDocument()
  })
})
