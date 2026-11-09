import type {
  ListContactOptionsResponse,
  ListContactsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { HumanInputV2NodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedToolProviders } from '@/test/console/tool-providers'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import { HumanInputV2Panel } from '../panel'
import { createChannelsQueryClient } from './channel-fixtures'

const hitlIm = vi.hoisted(() => ({ enabled: true }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.humanInput.v2.contacts.get': async () =>
        ({ data: [], total: 0, page: 1, limit: 1 }) satisfies ListContactsResponse,
      'workspaces.current.humanInput.v2.contactOptions.get': async () =>
        ({ data: [], total: 0, page: 1, limit: 20 }) satisfies ListContactOptionsResponse,
    }),
  }
})

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return hitlIm.enabled
  },
}))

const createData = (overrides: Partial<HumanInputV2NodeType> = {}): HumanInputV2NodeType => ({
  type: BlockEnum.HumanInput,
  version: '2',
  title: 'Human Input v2',
  desc: '',
  recipients_spec: [],
  message_template: { subject: 'Original subject', body: 'Review {{#url#}}' },
  debug_mode: { enabled: false, channels: [] },
  form_content: 'Review this request',
  inputs: [],
  user_actions: [],
  timeout: 36,
  timeout_unit: 'hour',
  ...overrides,
})

const renderPanel = (data = createData()) => {
  const queryClient = createChannelsQueryClient(['resend', 'slack'])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedAccountProfileQuery(queryClient, { email: 'reviewer@example.com' })
  return renderNodePanel(HumanInputV2Panel, data, {
    queryClient,
    hooksStoreProps: { doSyncWorkflowDraft: async () => null },
  })
}

describe('Human Input v2 panel composition', () => {
  beforeEach(() => {
    hitlIm.enabled = true
  })

  it('persists recipient, message-template, and debug settings through the live node panel', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel()

    expect(screen.queryByText(/delivery method/i)).not.toBeInTheDocument()

    const recipient = screen.getByLabelText('workflow.nodes.humanInputV2.recipients.placeholder')
    await user.click(recipient)
    await user.paste('reviewer@example.com')
    await user.keyboard('{Enter}')
    expect(data().recipients_spec).toEqual([
      { type: 'onetime_email', email: 'reviewer@example.com' },
    ])

    await user.click(screen.getByRole('button', { name: 'workflow.common.configure' }))
    const subject = screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')
    await user.clear(subject)
    await user.type(subject, 'Updated subject')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(data().message_template).toEqual({
      subject: 'Updated subject',
      body: 'Review {{#url#}}',
    })

    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.debug.configure' }),
    )
    await user.click(
      screen.getByRole('checkbox', {
        name: 'workflow.nodes.humanInputV2.debug.channel.email',
      }),
    )
    await user.click(
      screen.getByRole('switch', { name: 'workflow.nodes.humanInputV2.debug.toggle' }),
    )
    expect(data().debug_mode).toEqual({ enabled: true, channels: ['email'] })
  })

  it('keeps stored v2 settings intact and unavailable while the feature is disabled', () => {
    hitlIm.enabled = false
    const stored = createData({
      recipients_spec: [{ type: 'contact', contact_id: 'stored-contact' }],
      message_template: { subject: 'Stored subject', body: 'Stored {{#url#}}' },
    })
    const original = structuredClone(stored)
    const { data } = renderPanel(stored)

    expect(screen.getByRole('status')).toHaveTextContent('workflow.nodes.humanInputV2.disabled')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(data()).toMatchObject(original)
  })
})
