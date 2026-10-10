import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockEmojiData, renderWithEmoji } from '@/test/emoji-picker'
import { EditAgentDialog } from '../edit-agent-dialog'

const updateAgent = vi.hoisted(() => vi.fn().mockResolvedValue({}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleQuery: {
      ...actual.consoleQuery,
      files: actual.consoleQuery.files,
      agent: {
        ...actual.consoleQuery.agent,
        byAgentId: {
          ...actual.consoleQuery.agent.byAgentId,
          put: { mutationOptions: () => ({ mutationFn: updateAgent }) },
        },
      },
    },
  }
})

mockEmojiData()

const agent: AgentAppPartial = {
  id: 'agent-1',
  name: 'Research Agent',
  description: 'Find market materials.',
  role: 'Research Assistant',
  mode: 'agent',
  icon_type: 'emoji',
  icon: '🧸',
  icon_background: '#F5F3FF',
  icon_url: null,
  permission_keys: [],
}

it('keeps icon drafts out of form dirty state and submits only the confirmed icon with text edits', async () => {
  const user = userEvent.setup()
  renderWithEmoji(<EditAgentDialog agent={agent} open onOpenChange={vi.fn()} />)
  const formDialog = screen.getByRole('dialog', { name: 'agentRoster.roster.editDialog.title' })
  const save = within(formDialog).getByRole('button', { name: 'common.operation.save' })
  const iconTrigger = within(formDialog).getByRole('button', {
    name: 'agentRoster.roster.createForm.changeIcon',
  })
  expect(save).toBeDisabled()

  await user.click(iconTrigger)
  const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
  await user.type(within(picker).getByPlaceholderText('app.iconPicker.search'), 'bear')
  await user.click(within(picker).getByRole('radio', { name: 'app.iconPicker.color.green' }))
  await user.keyboard('{Escape}')
  await waitFor(() => expect(picker).not.toBeInTheDocument())
  expect(save).toBeDisabled()
  expect(updateAgent).not.toHaveBeenCalled()

  const name = within(formDialog).getByRole('textbox', {
    name: 'agentRoster.roster.createForm.nameLabel',
  })
  await user.clear(name)
  await user.type(name, 'Market Agent')
  expect(save).toBeEnabled()
  await user.click(iconTrigger)
  const reopenedPicker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
  await user.type(within(reopenedPicker).getByPlaceholderText('app.iconPicker.search'), 'bear')
  await user.click(
    within(reopenedPicker).getByRole('radio', { name: 'app.iconPicker.color.green' }),
  )
  await user.keyboard('{Escape}')
  await waitFor(() => expect(reopenedPicker).not.toBeInTheDocument())
  expect(save).toBeEnabled()

  await user.click(iconTrigger)
  const confirmingPicker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
  await user.click(
    within(confirmingPicker).getByRole('radio', { name: 'app.iconPicker.color.green' }),
  )
  await user.click(within(confirmingPicker).getByRole('button', { name: 'app.iconPicker.ok' }))
  await waitFor(() => expect(confirmingPicker).not.toBeInTheDocument())
  expect(updateAgent).not.toHaveBeenCalled()
  await user.click(save)
  await waitFor(() =>
    expect(updateAgent).toHaveBeenCalledWith(
      {
        params: { agent_id: 'agent-1' },
        body: {
          name: 'Market Agent',
          description: 'Find market materials.',
          role: 'Research Assistant',
          icon_type: 'emoji',
          icon: '🧸',
          icon_background: '#F3FEE7',
        },
      },
      expect.anything(),
    ),
  )
})
