import type { HumanInputV2NodeType } from '../types'
import { act, screen, waitFor } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { UserActionButtonType } from '../../human-input/shared/types'
import { HumanInputV2Node } from '../node'
import { contactApi, renderContactOwner as render, resetContactApi } from './fixtures/contact-api'

const mockHitlIm = vi.hoisted(() => ({ enabled: true }))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return mockHitlIm.enabled
  },
}))

vi.mock('@/service/console', async () => ({
  consoleQuery: (await import('./fixtures/contact-api')).testConsoleQuery,
}))

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
  beforeEach(() => {
    mockHitlIm.enabled = true
    resetContactApi()
  })

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

  it('renders deterministic overflow and unresolved states', async () => {
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
    expect(await screen.findByText('workflow.nodes.humanInputV2.card.invalid')).toBeInTheDocument()
  })

  it('summarizes all workspace contacts distinctly from the initiator and preserves mixed recipients', () => {
    const { rerender } = render(
      <HumanInputV2Node
        id="human-input-v2"
        data={createData({ recipients_spec: [{ type: 'all_workspace_contacts' }] })}
      />,
    )
    expect(
      screen.getByText('workflow.nodes.humanInputV2.recipients.allWorkspaceContacts'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('workflow.nodes.humanInputV2.card.initiatorOnly'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.humanInputV2.card.invalid')).not.toBeInTheDocument()
    rerender(
      <HumanInputV2Node
        id="human-input-v2"
        data={createData({
          recipients_spec: [{ type: 'all_workspace_contacts' }, { type: 'initiator' }],
        })}
      />,
    )
    expect(
      screen.getByText((text) => text.includes('workflow.nodes.humanInputV2.card.configured')),
    ).toHaveTextContent('"count":2')
    expect(
      screen.queryByText('workflow.nodes.humanInputV2.card.initiatorOnly'),
    ).not.toBeInTheDocument()
  })
})

it('preserves stored v2 branches without resolving contacts or exposing recipient summaries while disabled', () => {
  mockHitlIm.enabled = false
  contactApi.batch.mockClear()
  const data = createData({ recipients_spec: [{ type: 'contact', contact_id: 'stored-contact' }] })
  const original = structuredClone(data)
  render(<HumanInputV2Node id="human-input-v2" data={data} />)

  expect(screen.getByRole('status')).toHaveTextContent('workflow.nodes.humanInputV2.disabled')
  expect(screen.getByText('handle:approve')).toBeInTheDocument()
  expect(screen.getByText('handle:__timeout')).toBeInTheDocument()
  expect(screen.queryByText('workflow.nodes.humanInputV2.recipients.title')).not.toBeInTheDocument()
  expect(contactApi.batch).not.toHaveBeenCalled()
  expect(data).toEqual(original)
})

it('does not show a deleted-contact warning while the lookup is pending or rejected', async () => {
  mockHitlIm.enabled = true
  resetContactApi()
  let reject!: (error: Error) => void
  contactApi.batch.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  render(
    <HumanInputV2Node
      id="human-input-v2"
      data={createData({ recipients_spec: [{ type: 'contact', contact_id: 'pending' }] })}
    />,
  )
  await waitFor(() => expect(contactApi.batch).toHaveBeenCalled())
  expect(screen.queryByText('workflow.nodes.humanInputV2.card.invalid')).not.toBeInTheDocument()
  await act(async () => reject(new Error('offline')))
  expect(screen.queryByText('workflow.nodes.humanInputV2.card.invalid')).not.toBeInTheDocument()
})
