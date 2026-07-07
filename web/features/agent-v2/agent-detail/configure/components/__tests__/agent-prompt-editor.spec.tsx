import type { ReactNode } from 'react'
import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import type { AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { API_PREFIX } from '@/config'
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
const mockUseClipboard = vi.hoisted(() => vi.fn())
const mockConfigFiles = vi.hoisted(() => ({
  current: [] as Array<{
    id: string
    name: string
    driveKey?: string
    children?: Array<{
      id: string
      name: string
      driveKey?: string
    }>
  }>,
}))
const mockLexical = vi.hoisted(() => ({
  selection: null as null | {
    __range: true
    isCollapsed: () => boolean
    anchor: {
      getNode: () => {
        __text: true
        getKey: () => string
        getTextContent: () => string
        getTextContentSize: () => number
        select: (anchorOffset: number, focusOffset: number) => void
      }
      offset: number
    }
  },
  rootChildren: [] as Array<{
    __text: true
    getKey: () => string
    getTextContent: () => string
    getTextContentSize: () => number
    select: (anchorOffset: number, focusOffset: number) => void
  }>,
  rootSelectEnd: vi.fn(),
}))
const mockBuiltInTools = vi.hoisted(() => [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    author: 'Dify',
    description: { en_US: 'DuckDuckGo tools' },
    icon: 'duckduckgo.svg',
    icon_dark: 'duckduckgo-dark.svg',
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
        <div
          role="textbox"
          aria-controls={props['aria-controls']}
          aria-haspopup={props['aria-haspopup']}
          aria-label={String(props.placeholder)}
          tabIndex={0}
        >
          {String(props.value ?? '')}
        </div>
        {props.children}
      </div>
    )
  },
}))

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [{
    focus: (callback: () => void) => callback(),
    getEditorState: () => ({
      read: (callback: () => void) => callback(),
    }),
    registerCommand: () => vi.fn(),
    registerUpdateListener: () => vi.fn(),
    update: (callback: () => void) => callback(),
  }],
}))

vi.mock('lexical', () => ({
  $getRoot: () => ({
    getChildren: () => mockLexical.rootChildren,
    selectEnd: mockLexical.rootSelectEnd,
  }),
  $getSelection: () => mockLexical.selection,
  $isElementNode: (node: { __element?: boolean } | null | undefined) => !!node?.__element,
  $isRangeSelection: (selection: { __range?: boolean } | null | undefined) => !!selection?.__range,
  $isTextNode: (node: { __text?: boolean } | null | undefined) => !!node?.__text,
  COMMAND_PRIORITY_LOW: 1,
  SELECTION_CHANGE_COMMAND: Symbol('selection-change-command'),
}))

vi.mock('@/app/components/base/infotip', () => ({
  Infotip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: mockUseClipboard,
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
  useDocLink: () => 'https://docs.example.com',
}))

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (value: { currentWorkspace: { id: string } }) => string) => selector({
    currentWorkspace: { id: 'workspace-123' },
  }),
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

vi.mock('../orchestrate/config-context', () => ({
  useAgentConfigSkills: () => ({
    skills: [
      {
        id: 'playwright',
        name: 'Playwright',
        skillMdKey: 'skills/playwright/SKILL.md',
      },
    ],
  }),
  useAgentConfigFiles: () => ({ files: mockConfigFiles.current }),
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

const syncSlashMenuFromEditor = (textbox = screen.getByRole('textbox')) => {
  fireEvent.keyDown(textbox, { key: '/' })
  fireEvent.keyUp(textbox, { key: '/' })
}

const openSlashMenuFromEditor = async (textbox = screen.getByRole('textbox')) => {
  syncSlashMenuFromEditor(textbox)
  return screen.findByRole('dialog', { name: /agentDetail\.configure\.prompt\.insert\.label/i })
}

describe('AgentPromptEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.getSelection()?.removeAllRanges()
    mockConfigFiles.current = []
    mockLexical.selection = null
    mockLexical.rootChildren = []
    mockLexical.rootSelectEnd.mockClear()
    mockUseClipboard.mockReturnValue({
      copied: false,
      copy: mockCopy,
      reset: mockReset,
    })
  })

  // Prompt actions should expose the designed copy control and copy the current draft prompt.
  describe('Prompt Actions', () => {
    it('should label the editable prompt with the visible prompt heading', () => {
      renderAgentPromptEditor('Review these tenders')

      expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
        'aria-labelledby': 'agent-configure-prompt-label',
      }))
    })

    it('should copy the current prompt when the copy button is clicked', () => {
      renderAgentPromptEditor('Review these tenders')

      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.prompt\.copy/i }))

      expect(mockCopy).toHaveBeenCalledWith('Review these tenders')
    })

    it('should let clipboard timeout restore the copied state instead of resetting on mouse leave', () => {
      renderAgentPromptEditor('Review these tenders')

      expect(mockUseClipboard).toHaveBeenCalledWith(expect.objectContaining({
        timeout: 2000,
      }))

      fireEvent.mouseLeave(screen.getByRole('button', { name: /agentDetail\.configure\.prompt\.copy/i }))

      expect(mockReset).not.toHaveBeenCalled()
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
      renderAgentPromptEditor('Run tools', {
        tools: [{
          ...duckDuckGoProviderTool,
          iconClassName: 'i-custom-public-other-default-tool-icon',
        }],
      })

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

      const providerIcon = Array.from(container.querySelectorAll<HTMLElement>('[style]'))
        .find(element => element.style.backgroundImage)
      expect(providerIcon).toHaveStyle({
        backgroundImage: `url(${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=workspace-123&filename=duckduckgo.svg)`,
      })

      rerender(
        <>
          {renderIcon?.({
            kind: 'cli_tool',
            id: 'cli-1',
            label: 'Lark CLI',
          })}
        </>,
      )

      expect(container.querySelector('.i-ri-terminal-box-line')).not.toBeInTheDocument()
    })

    it('should warn only for prompt references missing from the current configuration', () => {
      mockConfigFiles.current = [{
        id: 'folder',
        name: 'Folder',
        children: [{
          id: 'file-1',
          name: 'Spec.md',
          driveKey: 'drive/spec.md',
        }],
      }]
      renderAgentPromptEditor('Review these tenders', {
        knowledgeRetrievals: [{ id: 'retrieval-1', name: 'Release Notes' }],
        tools: [
          duckDuckGoProviderTool,
          { id: 'cli-1', kind: 'cli', name: 'Lark CLI' },
        ],
      })

      const promptEditorProps = mockPromptEditor.mock.calls.at(-1)?.[0] as PromptEditorProps
      const getWarning = promptEditorProps.rosterReferenceBlock?.getWarning
      expect(getWarning).toBeDefined()

      expect(getWarning?.({ kind: 'skill', id: 'skills%2Fplaywright%2FSKILL.md', label: 'Playwright' })).toBeUndefined()
      expect(getWarning?.({ kind: 'file', id: 'drive%2Fspec.md', label: 'Spec.md' })).toBeUndefined()
      expect(getWarning?.({ kind: 'knowledge', id: 'retrieval-1', label: 'Release Notes' })).toBeUndefined()
      expect(getWarning?.({ kind: 'tool', id: 'duckduckgo/ddg_search', label: 'DuckDuckGo Search' })).toBeUndefined()
      expect(getWarning?.({ kind: 'tool-all', id: 'duckduckgo/*', label: 'DuckDuckGo' })).toBeUndefined()

      expect(getWarning?.({ kind: 'skill', id: 'missing-skill', label: 'Missing Skill' })).toContain('agentDetail.configure.prompt.referenceMissing')
      expect(getWarning?.({ kind: 'file', id: 'missing-file', label: 'Missing File' })).toContain('agentDetail.configure.prompt.referenceMissing')
      expect(getWarning?.({ kind: 'knowledge', id: 'missing-retrieval', label: 'Missing Retrieval' })).toContain('agentDetail.configure.prompt.referenceMissing')
      expect(getWarning?.({ kind: 'tool', id: 'missing/action', label: 'Missing Tool' })).toContain('agentDetail.configure.prompt.referenceMissing')
    })
  })

  // Prompt slash commands should use the Agent Roster category menu and replace it with submenus.
  describe('Slash Commands', () => {
    it('should open category menu, show skill submenu, and append the selected reference', async () => {
      const { store, rerenderWithValue, container } = renderAgentPromptEditor('Review these tenders')

      expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
        disableBracePicker: true,
        disableSlashPicker: true,
        rosterReferenceBlock: expect.objectContaining({
          show: true,
        }),
      }))

      rerenderWithValue('Review these tenders/')
      await openSlashMenuFromEditor()
      expect(container).toContainElement(screen.getByRole('dialog', { name: /agentDetail\.configure\.prompt\.insert\.label/i }))
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i }))
      expect(screen.queryByRole('button', { name: /agentDetail\.configure\.files\.label/i })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Playwright/i }))

      expect(store.get(agentComposerPromptAtom)).toBe('Review these tenders [§skill:playwright:Playwright§]')
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /Playwright/i })).not.toBeInTheDocument()
      })
    })

    it('should support keyboard navigation and selection in the slash menu', async () => {
      const user = userEvent.setup()
      const { store } = renderAgentPromptEditor('Review these tenders/')
      const textbox = screen.getByRole('textbox')

      textbox.focus()
      await openSlashMenuFromEditor(textbox)

      const skillsCategory = screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })
      const filesCategory = screen.getByRole('button', { name: /agentDetail\.configure\.files\.label/i })
      await waitFor(() => {
        expect(textbox).toHaveFocus()
        expect(textbox).toHaveAttribute('aria-controls', 'agent-configure-prompt-slash-menu')
        expect(textbox).toHaveAttribute('aria-haspopup', 'dialog')
      })

      await user.keyboard('{ArrowDown}')
      await waitFor(() => {
        expect(textbox).toHaveFocus()
        expect(skillsCategory).toHaveAttribute('data-agent-prompt-menu-active')
      })
      await user.keyboard('{ArrowDown}')
      await waitFor(() => {
        expect(textbox).toHaveFocus()
        expect(filesCategory).toHaveAttribute('data-agent-prompt-menu-active')
      })
      await user.keyboard('{ArrowRight}')
      await waitFor(() => {
        expect(textbox).toHaveFocus()
        expect(screen.getByRole('button', { name: /agentDetail\.configure\.files\.label/i })).toHaveAttribute('data-agent-prompt-menu-active')
      })
      await user.keyboard('{ArrowLeft}')
      await waitFor(() => {
        expect(textbox).toHaveFocus()
        expect(screen.getByRole('button', { name: /agentDetail\.configure\.files\.label/i })).toHaveAttribute('data-agent-prompt-menu-active')
        expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).not.toHaveAttribute('data-agent-prompt-menu-active')
      })
      await user.keyboard('{ArrowUp}')
      await waitFor(() => {
        expect(textbox).toHaveFocus()
        expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toHaveAttribute('data-agent-prompt-menu-active')
      })
      await user.keyboard('{ArrowRight}')
      await waitFor(() => {
        expect(textbox).toHaveFocus()
        expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toHaveAttribute('data-agent-prompt-menu-active')
      })

      await user.keyboard('{ArrowDown}')
      await waitFor(() => {
        expect(textbox).toHaveFocus()
        expect(screen.getByRole('button', { name: /Playwright/i })).toHaveAttribute('data-agent-prompt-menu-active')
      })
      await user.keyboard('{Enter}')

      expect(store.get(agentComposerPromptAtom)).toBe('Review these tenders [§skill:playwright:Playwright§]')
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /agentDetail\.configure\.prompt\.insert\.label/i })).not.toBeInTheDocument()
      })
    })

    it('should keep editor focus when selecting slash menu items with a pointer', async () => {
      const user = userEvent.setup()
      const { store } = renderAgentPromptEditor('Review these tenders/')
      const textbox = screen.getByRole('textbox')

      textbox.focus()
      await openSlashMenuFromEditor(textbox)

      await user.click(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i }))
      await waitFor(() => {
        expect(textbox).toHaveFocus()
        expect(screen.getByRole('button', { name: /Playwright/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Playwright/i }))

      expect(store.get(agentComposerPromptAtom)).toBe('Review these tenders [§skill:playwright:Playwright§]')
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /agentDetail\.configure\.prompt\.insert\.label/i })).not.toBeInTheDocument()
      })
    })

    it('should close the slash menu with Escape and restore focus to the editor', async () => {
      renderAgentPromptEditor('Review/')
      const textbox = screen.getByRole('textbox')

      textbox.focus()
      await openSlashMenuFromEditor(textbox)

      await waitFor(() => {
        expect(textbox).toHaveFocus()
      })

      fireEvent.keyDown(textbox, { key: 'Escape' })

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /agentDetail\.configure\.prompt\.insert\.label/i })).not.toBeInTheDocument()
      })
      await waitFor(() => {
        expect(textbox).toHaveFocus()
      })
    })

    it('should keep focus in the editor and position the menu from the typed slash', async () => {
      const getClientRectsSpy = vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
        const rect = this.collapsed
          ? DOMRect.fromRect({ x: 480, y: 76, width: 0, height: 18 })
          : DOMRect.fromRect({ x: 82, y: 76, width: 8, height: 18 })
        return [rect] as unknown as DOMRectList
      })
      const getBoundingClientRectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => (
        DOMRect.fromRect({ x: 10, y: 50, width: 500, height: 240 })
      ))

      try {
        renderAgentPromptEditor('Review/')
        const textbox = screen.getByRole('textbox')
        const textNode = textbox.firstChild
        expect(textNode).not.toBeNull()

        const range = document.createRange()
        range.setStart(textNode!, 'Review/'.length)
        range.setEnd(textNode!, 'Review/'.length)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)

        textbox.focus()
        const slashMenu = await openSlashMenuFromEditor(textbox)
        expect(textbox).toHaveFocus()
        expect(slashMenu).toHaveStyle({
          left: '80px',
          top: '48px',
        })
      }
      finally {
        window.getSelection()?.removeAllRanges()
        getClientRectsSpy.mockRestore()
        getBoundingClientRectSpy.mockRestore()
      }
    })

    it('should replace the slash at the current lexical selection instead of appending', async () => {
      const textNode = {
        __text: true as const,
        getKey: () => 'text-node',
        getTextContent: () => 'Review / now',
        getTextContentSize: () => 'Review / now'.length,
        select: vi.fn(),
      }
      mockLexical.rootChildren = [textNode]
      mockLexical.selection = {
        __range: true,
        isCollapsed: () => true,
        anchor: {
          getNode: () => textNode,
          offset: 'Review /'.length,
        },
      }
      const { store } = renderAgentPromptEditor('Review / now')
      const textbox = screen.getByRole('textbox')
      const range = document.createRange()
      range.setStart(textbox.firstChild!, 'Review /'.length)
      range.setEnd(textbox.firstChild!, 'Review /'.length)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      textbox.focus()

      await openSlashMenuFromEditor(textbox)
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i }))
      fireEvent.click(screen.getByRole('button', { name: /Playwright/i }))

      expect(store.get(agentComposerPromptAtom)).toBe('Review [§skill:playwright:Playwright§] now')
      await waitFor(() => {
        expect(mockLexical.rootSelectEnd).toHaveBeenCalled()
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

    it('should insert references after prompt add actions create skills, files, or knowledge retrievals', () => {
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
          onAddProviderTools={vi.fn()}
          onAddSkill={options => options?.onAdded?.({ id: 'skill-1', name: 'Skill One' })}
          retrievals={[]}
          onBack={vi.fn()}
          onOpenCategory={vi.fn()}
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.add/i }))
      expect(onSelect).toHaveBeenCalledWith('[§skill:skill-1:Skill One§]')

      rerender(
        <AgentPromptSlashMenu
          view="files"
          categories={categories}
          skills={[]}
          files={[]}
          tools={[]}
          onAddProviderTools={vi.fn()}
          onAddFile={options => options?.onAdded?.({ id: 'file-1', name: 'Guide.md', icon: 'markdown', configName: 'Guide.md' })}
          retrievals={[]}
          onBack={vi.fn()}
          onOpenCategory={vi.fn()}
          onSelect={onSelect}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.files\.add/i }))
      expect(onSelect).toHaveBeenCalledWith('[§file:Guide.md:Guide.md§]')

      rerender(
        <AgentPromptSlashMenu
          view="knowledge"
          categories={categories}
          skills={[]}
          files={[]}
          tools={[]}
          onAddProviderTools={vi.fn()}
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
          onAddProviderTools={vi.fn()}
          onAddCliTool={options => options?.onAdded?.({ id: 'cli-1', kind: 'cli', name: 'Lark CLI' })}
          retrievals={[]}
          onBack={vi.fn()}
          onOpenCategory={vi.fn()}
          onSelect={onSelect}
        />,
      )
      expect(screen.queryByRole('button', { name: /agentDetail\.configure\.tools\.cliDialog\.title/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /agentDetail\.configure\.tools\.toolTabs\.cli/i })).not.toBeInTheDocument()
    })

    it('should append available provider tool references and add missing tools to the configuration', async () => {
      const { store, rerenderWithValue } = renderAgentPromptEditor('Research/', { tools: [] })
      const expectedProviderIcon = `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=workspace-123&filename=duckduckgo.svg`

      await openSlashMenuFromEditor()
      fireEvent.click(screen.getByRole('button', { name: /agentDetail\.configure\.tools\.label/i }))
      const providerButton = screen.getByRole('button', { name: /DuckDuckGo.*agentDetail\.configure\.tools\.toolTabs\.plugins/i })
      const providerIcon = Array.from(providerButton.querySelectorAll<HTMLElement>('[style]'))
        .find(element => element.style.backgroundImage)
      expect(providerIcon).toHaveStyle({ backgroundImage: `url(${expectedProviderIcon})` })
      fireEvent.click(screen.getByRole('button', { name: 'DuckDuckGo' }))
      fireEvent.click(screen.getByRole('button', { name: /DuckDuckGo Search/i }))

      expect(store.get(agentComposerPromptAtom)).toBe('Research [§tool:duckduckgo/ddg_search:DuckDuckGo Search§]')
      expect(store.get(agentComposerDraftAtom).tools).toEqual([
        expect.objectContaining({
          id: 'duckduckgo',
          icon: expectedProviderIcon,
          actions: [
            expect.objectContaining({
              name: 'DuckDuckGo Search',
              toolName: 'ddg_search',
            }),
          ],
        }),
      ])

      rerenderWithValue('Research/')
      await openSlashMenuFromEditor()
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

      await openSlashMenuFromEditor()
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

      rerenderWithValue('Review')
      fireEvent.keyUp(screen.getByRole('textbox'), { key: 'Backspace' })

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).not.toBeInTheDocument()
      })

      rerenderWithValue('Review/')
      await openSlashMenuFromEditor()
      expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

      fireEvent.pointerDown(document.body)

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).not.toBeInTheDocument()
      })
    })

    it('should close the slash menu when focus moves outside the prompt editor', async () => {
      const outsideButton = document.createElement('button')
      document.body.append(outsideButton)

      try {
        renderAgentPromptEditor('Review/')

        await openSlashMenuFromEditor()
        expect(screen.getByRole('button', { name: /agentDetail\.configure\.skills\.label/i })).toBeInTheDocument()

        fireEvent.focusIn(outsideButton)

        await waitFor(() => {
          expect(screen.queryByRole('dialog', { name: /agentDetail\.configure\.prompt\.insert\.label/i })).not.toBeInTheDocument()
        })
      }
      finally {
        outsideButton.remove()
      }
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
