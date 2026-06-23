import type { ReactNode } from 'react'
import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import type { AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { agentComposerKnowledgeRetrievalsAtom } from '@/features/agent-v2/agent-composer/store-modules/knowledge'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { agentComposerToolsAtom } from '@/features/agent-v2/agent-composer/store-modules/tools'
import { AgentPromptEditor } from '../orchestrate/prompt-editor'
import { AgentPromptSlashMenu } from '../orchestrate/prompt-editor/slash'

const mockPromptEditor = vi.hoisted(() => vi.fn())
const mockCopy = vi.hoisted(() => vi.fn())
const mockReset = vi.hoisted(() => vi.fn())
const mockBuiltInTools = vi.hoisted(() => [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    author: 'Dify',
    description: { en_US: 'DuckDuckGo tools' },
    icon: '/duckduckgo.svg',
    label: { en_US: 'DuckDuckGo' },
    type: 'builtin',
    team_credentials: {},
    is_team_authorization: true,
    allow_delete: false,
    labels: [],
    meta: {},
    tools: [
      {
        name: 'ddg_search',
        author: 'Dify',
        label: { en_US: 'DuckDuckGo Search' },
        description: { en_US: 'Search the web.' },
        parameters: [],
        labels: [],
        output_schema: {},
      },
      {
        name: 'ddg_translate',
        author: 'Dify',
        label: { en_US: 'DuckDuckGo Translate' },
        description: { en_US: 'Translate search results.' },
        parameters: [],
        labels: [],
        output_schema: {},
      },
    ],
  },
])

vi.mock('@/app/components/base/prompt-editor', () => ({
  __esModule: true,
  default: (props: PromptEditorProps) => {
    mockPromptEditor(props)

    return (
      <div>
        <div role="textbox" aria-label={String(props.placeholder)} />
      </div>
    )
  },
}))

vi.mock('@/app/components/base/infotip', () => ({
  Infotip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copied: false,
    copy: mockCopy,
    reset: mockReset,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: mockBuiltInTools }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('../orchestrate/drive-context', () => ({
  useAgentDriveSkills: () => ({
    skills: [
      {
        id: 'playwright/SKILL.md',
        name: 'Playwright',
        skillMdKey: 'playwright/SKILL.md',
      },
    ],
  }),
  useAgentDriveFiles: () => ({ files: [] }),
}))

const duckDuckGoSearchAction = {
  id: 'duckduckgo-search',
  name: 'DuckDuckGo Search',
  toolName: 'ddg_search',
  description: 'Search the web.',
}

const duckDuckGoProviderTool: AgentTool = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  kind: 'provider',
  iconClassName: 'i-simple-icons-duckduckgo',
  credentialKey: 'agentDetail.configure.tools.credential.authOne',
  credentialVariant: 'authorized',
  actions: [
    duckDuckGoSearchAction,
  ],
}

const promptEditorDraft = {
  ...defaultAgentSoulConfigFormState,
  tools: [duckDuckGoProviderTool],
} satisfies typeof defaultAgentSoulConfigFormState

const renderAgentPromptEditor = (
  value: string,
  draftOverrides: Partial<typeof defaultAgentSoulConfigFormState> = {},
) => {
  const store = createStore()
  store.set(agentComposerDraftAtom, {
    ...promptEditorDraft,
    ...draftOverrides,
    prompt: value,
  })

  const view = render(
    <JotaiProvider store={store}>
      <AgentPromptEditor />
    </JotaiProvider>,
  )

  return {
    store,
    ...view,
    rerenderWithValue: (nextValue: string) => {
      store.set(agentComposerPromptAtom, nextValue)
      view.rerender(
        <JotaiProvider store={store}>
          <AgentPromptEditor />
        </JotaiProvider>,
      )
    },
  }
}

describe('AgentPromptEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Prompt actions should expose the designed copy control and copy the current draft prompt.
  describe('Prompt Actions', () => {
    it('should copy the current prompt when the copy button is clicked', () => {
      renderAgentPromptEditor('Review these tenders')

      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.prompt\.copy/i }))

      expect(mockCopy).toHaveBeenCalledWith('Review these tenders')
    })

    it('should update knowledge reference labels when the retrieval title changes', () => {
      const store = createStore()
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Use [§knowledge:retrieval-1:Old Search§] and [§knowledge:retrieval-2:Keep Search§]',
        knowledgeRetrievals: [
          { id: 'retrieval-1', name: 'Old Search' },
          { id: 'retrieval-2', name: 'Keep Search' },
        ],
      })

      store.set(agentComposerKnowledgeRetrievalsAtom, [
        { id: 'retrieval-1', name: 'Release Search' },
        { id: 'retrieval-2', name: 'Keep Search' },
      ])

      expect(store.get(agentComposerPromptAtom)).toBe('Use [§knowledge:retrieval-1:Release Search§] and [§knowledge:retrieval-2:Keep Search§]')
    })

    it('should update CLI tool reference labels when the tool title changes', () => {
      const store = createStore()
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Run [§cli_tool:cli-1:Old CLI§] and [§tool:duckduckgo/ddg_search:DuckDuckGo Search§]',
        tools: [
          { id: 'cli-1', kind: 'cli', name: 'Old CLI' },
          duckDuckGoProviderTool,
        ],
      })

      store.set(agentComposerToolsAtom, [
        { id: 'cli-1', kind: 'cli', name: 'Release CLI' },
        {
          ...duckDuckGoProviderTool,
          actions: [
            {
              ...duckDuckGoSearchAction,
              name: 'Renamed Provider Action',
            },
          ],
        },
      ])

      expect(store.get(agentComposerPromptAtom)).toBe('Run [§cli_tool:cli-1:Release CLI§] and [§tool:duckduckgo/ddg_search:DuckDuckGo Search§]')
    })

    it('should render selected tool reference icons from configured tools', () => {
      renderAgentPromptEditor('Run tools')

      const promptEditorProps = mockPromptEditor.mock.calls.at(-1)?.[0] as PromptEditorProps
      const renderIcon = promptEditorProps.rosterReferenceBlock?.renderIcon
      expect(renderIcon).toBeDefined()

      const { container, rerender } = render(
        <>
          {renderIcon?.({
            kind: 'tool',
            id: 'duckduckgo/ddg_search',
            label: 'DuckDuckGo Search',
          })}
        </>,
      )

      expect(container.querySelector('.i-simple-icons-duckduckgo')).toBeInTheDocument()

      rerender(
        <>
          {renderIcon?.({
            kind: 'cli_tool',
            id: 'cli-1',
            label: 'Lark CLI',
          })}
        </>,
      )

      expect(container.querySelector('.i-ri-terminal-box-line')).toBeInTheDocument()
    })
  })

  // Prompt slash commands should use the Agent Roster category menu and replace it with submenus.
  describe('Slash Commands', () => {
    it('should open category menu, show skill submenu, and append the selected reference', async () => {
      const { store, rerenderWithValue } = renderAgentPromptEditor('Review these tenders')

      expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
        disableBracePicker: true,
        disableSlashPicker: true,
        rosterReferenceBlock: expect.objectContaining({
          show: true,
        }),
      }))

      expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })).toBe(true)
      rerenderWithValue('Review these tenders/')
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i }))
      expect(screen.queryByRole('button', { name: /agentDetail\.configure\.files\.label/i })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Playwright/i }))

      expect(store.get(agentComposerPromptAtom)).toBe('Review these tenders [§skill:playwright%2FSKILL.md:Playwright§]')
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /Playwright/i })).not.toBeInTheDocument()
      })
    })

    it('should insert slash from the focused footer insert action', () => {
      const { store } = renderAgentPromptEditor('Review these tenders')

      fireEvent.focus(screen.getByRole('textbox'))
      const insertButton = screen.getByRole('button', { name: /agentDetail\.configure\.prompt\.insert\.label/i })
      fireEvent.pointerDown(insertButton)
      fireEvent.click(insertButton)
      fireEvent.pointerUp(insertButton)

      expect(store.get(agentComposerPromptAtom)).toBe('Review these tenders/')
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /agentDetail\.configure\.prompt\.mention\.label/i })).not.toBeInTheDocument()
    })

    it('should insert references after prompt add actions create skills, files, CLI tools, or knowledge retrievals', () => {
      const onSelect = vi.fn()
      const categories = [
        { key: 'skills' as const, label: 'Skills', icon: 'i-ri-box-3-line' },
        { key: 'files' as const, label: 'Files', icon: 'i-ri-file-line' },
        { key: 'tools' as const, label: 'Tools', icon: 'i-ri-box-3-line' },
        { key: 'knowledge' as const, label: 'Knowledge', icon: 'i-ri-book-open-line' },
      ]

      const { rerender } = render(
        <AgentPromptSlashMenu
          view="skills"
          categories={categories}
          skills={[]}
          files={[]}
          tools={[]}
          onToolsChange={vi.fn()}
          onAddSkill={options => options?.onAdded?.({ id: 'skill-1', name: 'Skill One', skillMdKey: 'skills/skill-1/SKILL.md' })}
          retrievals={[]}
          onBack={vi.fn()}
          onOpenCategory={vi.fn()}
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.add/i }))
      expect(onSelect).toHaveBeenCalledWith('[§skill:skills%2Fskill-1%2FSKILL.md:Skill One§]')

      rerender(
        <AgentPromptSlashMenu
          view="files"
          categories={categories}
          skills={[]}
          files={[]}
          tools={[]}
          onToolsChange={vi.fn()}
          onAddFile={options => options?.onAdded?.({ id: 'file-1', name: 'Guide.md', icon: 'markdown', driveKey: 'files/Guide.md' })}
          retrievals={[]}
          onBack={vi.fn()}
          onOpenCategory={vi.fn()}
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.files\.add/i }))
      expect(onSelect).toHaveBeenCalledWith('[§file:files%2FGuide.md:Guide.md§]')

      rerender(
        <AgentPromptSlashMenu
          view="knowledge"
          categories={categories}
          skills={[]}
          files={[]}
          tools={[]}
          onToolsChange={vi.fn()}
          onAddKnowledge={options => options?.onAdded?.({ id: 'retrieval-1', name: 'Retrieval One', queryMode: 'agent' })}
          retrievals={[]}
          onBack={vi.fn()}
          onOpenCategory={vi.fn()}
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.knowledgeRetrieval\.add/i }))
      expect(onSelect).toHaveBeenCalledWith('[§knowledge:retrieval-1:Retrieval One§]')

      rerender(
        <AgentPromptSlashMenu
          view="tools"
          categories={categories}
          skills={[]}
          files={[]}
          tools={[]}
          onToolsChange={vi.fn()}
          onAddCliTool={options => options?.onAdded?.({ id: 'cli-1', kind: 'cli', name: 'Lark CLI' })}
          retrievals={[]}
          onBack={vi.fn()}
          onOpenCategory={vi.fn()}
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.tools\.cliDialog\.title/i }))
      expect(onSelect).toHaveBeenCalledWith('[§cli_tool:cli-1:Lark CLI§]')
    })

    it('should append available provider tool references and add missing tools to the configuration', () => {
      const { store, rerenderWithValue } = renderAgentPromptEditor('Research/', { tools: [] })

      fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.tools\.label/i }))
      fireEvent.click(screen.getByRole('button', { name: 'DuckDuckGo' }))
      fireEvent.click(screen.getByRole('button', { name: /DuckDuckGo Search/i }))

      expect(store.get(agentComposerPromptAtom)).toBe('Research [§tool:duckduckgo/ddg_search:DuckDuckGo Search§]')
      expect(store.get(agentComposerDraftAtom).tools).toEqual([
        expect.objectContaining({
          id: 'duckduckgo',
          actions: [
            expect.objectContaining({
              name: 'DuckDuckGo Search',
              toolName: 'ddg_search',
            }),
          ],
        }),
      ])

      rerenderWithValue('Research/')
      fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.tools\.label/i }))
      fireEvent.click(screen.getByRole('button', { name: /DuckDuckGo.*agentDetail\.configure\.tools\.toolTabs\.plugins/i }))

      expect(store.get(agentComposerPromptAtom)).toBe('Research [§tool:duckduckgo/*:DuckDuckGo§]')
      expect(store.get(agentComposerDraftAtom).tools).toEqual([
        expect.objectContaining({
          id: 'duckduckgo',
          actions: [
            expect.objectContaining({ toolName: 'ddg_search' }),
            expect.objectContaining({ toolName: 'ddg_translate' }),
          ],
        }),
      ])
    })

    it('should close slash menu when slash is deleted or the user clicks outside', async () => {
      const { rerenderWithValue } = renderAgentPromptEditor('Review/')

      fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

      rerenderWithValue('Review')
      fireEvent.keyUp(screen.getByRole('textbox'), { key: 'Backspace' })

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).not.toBeInTheDocument()
      })

      rerenderWithValue('Review/')
      fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

      fireEvent.pointerDown(document.body)

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).not.toBeInTheDocument()
      })
    })

    it('should reopen slash menu when the cursor is positioned after slash', async () => {
      renderAgentPromptEditor('Review/')

      fireEvent.keyUp(screen.getByRole('textbox'), { key: 'ArrowRight' })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()
      })
    })
  })
})
