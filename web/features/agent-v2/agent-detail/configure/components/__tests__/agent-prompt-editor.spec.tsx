import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { agentComposerToolsAtom } from '@/features/agent-v2/agent-composer/store-modules/tools'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { AgentPromptEditor, AgentTemplatePromptEditor } from '../orchestrate/prompt-editor'
import {
  createAgentPromptEnvironment,
  duckDuckGoProvider,
  duckDuckGoTool,
  mondayProvider,
} from './agent-prompt-editor-test-env'

const renderEditor = (options: Parameters<typeof createAgentPromptEnvironment>[0] = {}) => {
  const env = createAgentPromptEnvironment(options)
  return { ...env, ...render(env.wrap(<AgentPromptEditor />)) }
}
const menuName = /agentDetail\.configure\.prompt\.insert\.label/
const skillsName = /agentDetail\.configure\.skills\.label/
const toolsName = /agentDetail\.configure\.tools\.label/
const openMenu = async (user: ReturnType<typeof userEvent.setup>, prefix = 'Review ') => {
  const editor = screen.getByRole('textbox')
  await user.click(editor)
  await replacePromptEditorText(editor, prefix)
  await user.keyboard('/')
  return screen.findByRole('dialog', { name: menuName })
}

describe('AgentPromptEditor', () => {
  it('copies the serialized draft and shows feedback while the copy control is hovered', async () => {
    const user = userEvent.setup()
    renderEditor({ draft: { prompt: 'Review these tenders' } })
    const copy = screen.getByRole('button', { name: /agentDetail\.configure\.prompt\.copy/ })
    await user.hover(copy)
    await user.click(copy)
    expect(await screen.findByText(/agentDetail\.configure\.prompt\.copied$/)).toBeVisible()
    expect(await navigator.clipboard.readText()).toBe('Review these tenders')
    await user.unhover(copy)
    await waitFor(() =>
      expect(screen.queryByText(/agentDetail\.configure\.prompt\.copied$/)).not.toBeInTheDocument(),
    )
  })

  it('updates the rendered CLI reference when its configured name changes without renaming provider tokens', async () => {
    const { store } = renderEditor({
      draft: {
        prompt:
          'Run [§cli_tool:cli-1:Old CLI§] and [§tool:duckduckgo/ddg_search:DuckDuckGo Search§]',
        tools: [{ id: 'cli-1', kind: 'cli', name: 'Old CLI' }, duckDuckGoTool],
      },
    })
    act(() =>
      store.set(agentComposerToolsAtom, [
        { id: 'cli-1', kind: 'cli', name: 'Release CLI' },
        {
          ...duckDuckGoTool,
          actions: [{ ...duckDuckGoTool.actions[0]!, name: 'Renamed Provider Action' }],
        },
      ]),
    )
    expect(await within(screen.getByRole('textbox')).findByText('Release CLI')).toBeVisible()
    expect(store.get(agentComposerPromptAtom)).toBe(
      'Run [§cli_tool:cli-1:Release CLI§] and [§tool:duckduckgo/ddg_search:DuckDuckGo Search§]',
    )
  })

  it.each([
    ['skill', 'skills%2Fplaywright%2FSKILL.md'],
    ['file', 'drive%2Fspec.md'],
    ['knowledge', 'retrieval-1'],
    ['tool', 'duckduckgo/ddg_search'],
    ['tool-all', 'duckduckgo/*'],
  ])(
    'warns about missing %s references while recognizing configured references',
    async (kind, configuredId) => {
      const user = userEvent.setup()
      renderEditor({
        draft: {
          prompt: `[§${kind}:${configuredId}:Configured§] [§${kind}:missing:Missing§]`,
          files: [
            {
              id: 'folder',
              name: 'Folder',
              icon: 'folder',
              children: [
                { id: 'file-1', name: 'Spec.md', icon: 'markdown', driveKey: 'drive/spec.md' },
              ],
            },
          ],
          knowledgeRetrievals: [{ id: 'retrieval-1', name: 'Release Notes' }],
        },
      })
      const editor = within(screen.getByRole('textbox'))
      await user.hover(await editor.findByText('Missing'))
      expect(await screen.findByText(/agentDetail.configure.prompt.referenceMissing/)).toBeVisible()
      await user.hover(editor.getByText('Configured'))
      await waitFor(() =>
        expect(
          screen.queryByText(/agentDetail.configure.prompt.referenceMissing/),
        ).not.toBeInTheDocument(),
      )
    },
  )

  it('inserts an embedded skill through the real slash picker', async () => {
    const user = userEvent.setup()
    const { store } = renderEditor()
    await openMenu(user)
    expect(
      screen.queryByRole('button', { name: /agentDetail.configure.knowledgeRetrieval.label/ }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: skillsName }))
    await user.click(screen.getByRole('button', { name: 'Playwright' }))
    await waitFor(() =>
      expect(store.get(agentComposerPromptAtom)).toBe('Review [§skill:playwright:Playwright§] '),
    )
    expect(within(screen.getByRole('textbox')).getByText('Playwright')).toBeVisible()
    expect(screen.queryByRole('dialog', { name: menuName })).not.toBeInTheDocument()
  })

  it('inserts a workspace library skill using its stable name', async () => {
    const user = userEvent.setup()
    const { store } = renderEditor()
    await openMenu(user)
    await user.click(screen.getByRole('button', { name: skillsName }))
    await user.click(screen.getByRole('button', { name: 'Library Skill' }))
    await waitFor(() =>
      expect(store.get(agentComposerPromptAtom)).toBe(
        'Review [§skill:library-skill:Library Skill§] ',
      ),
    )
  })

  it('keeps composition keys from selecting or closing the slash picker', async () => {
    const user = userEvent.setup()
    const { store } = renderEditor()
    const menu = await openMenu(user)
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('button', { name: 'Library Skill' })).toBeVisible()
    await user.keyboard('{ArrowDown}')
    const editor = screen.getByRole('textbox')
    fireEvent.compositionStart(editor)
    for (const key of ['ArrowDown', 'Enter', 'Escape'])
      fireEvent.keyDown(editor, { key, isComposing: true })
    fireEvent.compositionEnd(editor, { data: '' })
    expect(menu).toBeVisible()
    expect(store.get(agentComposerPromptAtom)).toBe('Review /')
    await user.click(screen.getByRole('button', { name: 'Library Skill' }))
    await waitFor(() =>
      expect(store.get(agentComposerPromptAtom)).toBe(
        'Review [§skill:library-skill:Library Skill§] ',
      ),
    )
  })

  it.each(['Review', 'Use https:', 'path/to'])(
    'does not treat a slash inside %s as a command',
    async (prefix) => {
      const user = userEvent.setup()
      const { store } = renderEditor()
      const editor = screen.getByRole('textbox')
      await user.click(editor)
      await replacePromptEditorText(editor, prefix)
      await user.keyboard('/')
      await waitFor(() => expect(store.get(agentComposerPromptAtom)).toBe(`${prefix}/`))
      expect(screen.queryByRole('dialog', { name: menuName })).not.toBeInTheDocument()
      await replacePromptEditorText(editor, `${prefix}/ `)
      await user.keyboard('/')
      expect(await screen.findByRole('dialog', { name: menuName })).toBeVisible()
    },
  )

  it('opens the footer insert action and dismisses without changing the draft again', async () => {
    const user = userEvent.setup()
    const { store } = renderEditor({ draft: { prompt: 'Review' } })
    await user.click(screen.getByRole('textbox'))
    await user.click(screen.getByRole('button', { name: menuName }))
    expect(await screen.findByRole('dialog', { name: menuName })).toBeVisible()
    expect(store.get(agentComposerPromptAtom)).toBe('Review/')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: menuName })).not.toBeInTheDocument(),
    )
    expect(store.get(agentComposerPromptAtom)).toBe('Review/')
  })

  it('closes the picker when the user clicks outside', async () => {
    const user = userEvent.setup()
    const env = createAgentPromptEnvironment()
    render(
      env.wrap(
        <>
          <AgentPromptEditor />
          <button type="button">Outside</button>
        </>,
      ),
    )
    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: menuName })).not.toBeInTheDocument(),
    )
  })

  it.each([
    {
      provider: duckDuckGoProvider,
      providerId: 'duckduckgo',
      name: 'DuckDuckGo',
      action: 'DuckDuckGo Search',
      toolName: 'ddg_search',
      actionCount: 2,
    },
    {
      provider: mondayProvider,
      providerId: 'monday_mcp',
      name: 'Monday MCP',
      action: 'List Boards',
      toolName: 'list_boards',
      actionCount: 1,
    },
  ])(
    'adds $name to the configuration when inserting an unconfigured tool',
    async ({ provider, providerId, name, action, toolName, actionCount }) => {
      const user = userEvent.setup()
      const { store } = renderEditor({
        draft: { tools: [] },
        mcpTools: provider.type === 'mcp' ? [provider] : [],
      })
      await openMenu(user)
      await user.click(screen.getByRole('button', { name: toolsName }))
      await user.click(screen.getByRole('button', { name }))
      await user.click(screen.getByRole('button', { name: action }))
      await waitFor(() =>
        expect(store.get(agentComposerPromptAtom)).toBe(
          `Review [§tool:${providerId}/${toolName}:${action}§] `,
        ),
      )
      expect(store.get(agentComposerDraftAtom).tools).toEqual([
        expect.objectContaining({
          id: providerId,
          actions: [expect.objectContaining({ toolName })],
        }),
      ])
      await openMenu(user)
      await user.click(screen.getByRole('button', { name: toolsName }))
      await user.click(
        screen.getByRole('button', {
          name: new RegExp(`${name}.*agentDetail.configure.tools.toolTabs`),
        }),
      )
      await waitFor(() =>
        expect(store.get(agentComposerPromptAtom)).toBe(`Review [§tool:${providerId}/*:${name}§] `),
      )
      expect(
        store
          .get(agentComposerDraftAtom)
          .tools.flatMap((tool) => (tool.kind === 'provider' ? tool.actions : [])),
      ).toHaveLength(actionCount)
    },
  )

  it('lists configured providers and actions before unconfigured choices', async () => {
    const user = userEvent.setup()
    renderEditor({
      builtInTools: [
        createToolProviderFixture({
          id: 'wikipedia',
          name: 'Wikipedia',
          label: { en_US: 'Wikipedia' },
          tools: [
            {
              ...duckDuckGoProvider.tools![0]!,
              name: 'wikipedia_search',
              label: { en_US: 'Wikipedia Search' },
            },
          ],
        }),
        duckDuckGoProvider,
      ],
      draft: {
        tools: [
          {
            ...duckDuckGoTool,
            actions: [
              {
                id: 'translate',
                name: 'DuckDuckGo Translate',
                toolName: 'ddg_translate',
                description: 'Translate',
              },
            ],
          },
        ],
      },
    })
    const menu = within(await openMenu(user))
    await user.click(menu.getByRole('button', { name: toolsName }))
    expect(
      menu
        .getAllByRole('button', { name: /^(DuckDuckGo|Wikipedia)$/, expanded: false })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['DuckDuckGo', 'Wikipedia'])
    await user.click(menu.getByRole('button', { name: 'DuckDuckGo' }))
    expect(
      menu
        .getAllByRole('button', { name: /DuckDuckGo (Search|Translate)/ })
        .map((button) => button.textContent),
    ).toEqual(['DuckDuckGo Translate', 'DuckDuckGo Search'])
  })
})

it('renders template references as a readonly editor', async () => {
  const env = createAgentPromptEnvironment({
    draft: { prompt: 'Use [§tool:duckduckgo/ddg_search:DuckDuckGo Search§]' },
  })
  render(env.wrap(<AgentTemplatePromptEditor />))
  const editor = screen.getByRole('textbox')
  expect(editor).toHaveAttribute('contenteditable', 'false')
  expect(await within(editor).findByText('DuckDuckGo Search')).toBeVisible()
  expect(screen.queryByRole('button', { name: menuName })).not.toBeInTheDocument()
})
