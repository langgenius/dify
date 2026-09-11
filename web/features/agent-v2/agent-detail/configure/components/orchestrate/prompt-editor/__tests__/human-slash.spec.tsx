import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { describe, expect, it, vi } from 'vite-plus/test'
import { agentComposerHumanContactsAtom } from '@/features/agent-v2/agent-composer/store-modules/human-contacts'
import { AgentPromptSlashMenu } from '../slash'

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        {
          id: 'member-1',
          name: 'Alice',
          email: 'alice@example.com',
          avatar: '',
          avatar_url: null,
          status: 'active',
          role: 'editor',
          roles: [],
        },
      ],
    },
  }),
}))

const baseProps = {
  categories: [],
  skills: [],
  files: [],
  configuredTools: [],
  knowledgeRetrievals: [],
  onAddProviderTools: vi.fn(),
  onBack: vi.fn(),
  onOpenCategory: vi.fn(),
  onInsertToken: vi.fn(),
}

const humanCategoryLabel = 'agentV2.agentDetail.configure.humanContacts.label'

describe('AgentPromptSlashMenu Human references', () => {
  it('exposes Humans as a native Prompt reference category', async () => {
    const user = userEvent.setup()
    const onOpenCategory = vi.fn()

    render(
      <AgentPromptSlashMenu
        {...baseProps}
        view="main"
        onOpenCategory={onOpenCategory}
      />,
    )

    await user.click(screen.getByRole('button', { name: humanCategoryLabel }))
    expect(onOpenCategory).toHaveBeenCalledWith('humans')
  })

  it('persists a workspace member and inserts its Human token through the Prompt menu', async () => {
    const user = userEvent.setup()
    const onInsertToken = vi.fn()
    const store = createStore()

    render(
      <JotaiProvider store={store}>
        <AgentPromptSlashMenu
          {...baseProps}
          view="humans"
          onInsertToken={onInsertToken}
        />
      </JotaiProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Alice' }))

    expect(store.get(agentComposerHumanContactsAtom)).toEqual([
      {
        id: 'member-1',
        name: 'Alice',
        email: 'alice@example.com',
        channel: 'email',
      },
    ])
    expect(onInsertToken).toHaveBeenCalledWith('[§human:member-1:Alice§]')
  })
})
