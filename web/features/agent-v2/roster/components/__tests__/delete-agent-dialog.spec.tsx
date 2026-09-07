import { render, screen } from '@testing-library/react'
import { DeleteAgentDialog } from '../delete-agent-dialog'

const mutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => mutationMock,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        delete: {
          mutationOptions: vi.fn(() => ({})),
        },
      },
    },
  },
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: agentV2 } = await import('@/i18n/en-US/agent-v-2.json')
  return createReactI18nextMock({
    'roster.deleteDialog.description': agentV2['roster.deleteDialog.description'],
    'roster.deleteDialog.title': agentV2['roster.deleteDialog.title'],
  })
})

describe('DeleteAgentDialog', () => {
  it('identifies the deleted agent and explains the irreversible impact', () => {
    render(
      <DeleteAgentDialog
        agentId="agent-1"
        agentName="Research Agent"
        open
        onOpenChange={vi.fn()}
      />,
    )

    expect(
      screen.getByText(
        'This permanently deletes Research Agent. Its web app, API access, and workflows that use it stop working immediately.',
      ),
    ).toBeInTheDocument()
  })
})
