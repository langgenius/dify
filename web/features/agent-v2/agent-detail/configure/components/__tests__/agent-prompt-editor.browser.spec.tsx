import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { AgentPromptEditor } from '../orchestrate/prompt-editor'
import { createAgentPromptEnvironment } from './agent-prompt-editor-test-env'

it('replaces the slash at the native caret and keeps subsequent typing before the remaining prompt', async () => {
  // The owner must preserve a native selection through its pointer-driven menu and Lexical token replacement.
  const { wrap, store, queryClient } = createAgentPromptEnvironment()
  const screen = await render(wrap(<AgentPromptEditor />))
  const editor = screen.getByRole('textbox')
  await editor.fill('Review / now')
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
  const menu = screen.getByRole('dialog', { name: /agentDetail.configure.prompt.insert.label/ })
  await expect.element(menu).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(menu.getByRole('button', { name: 'Playwright' })).toBeVisible()
  await menu.getByRole('button', { name: 'Playwright' }).click()
  await expect.element(menu).not.toBeInTheDocument()
  await expect.element(editor).toHaveFocus()
  await expect
    .poll(() => store.get(agentComposerPromptAtom))
    .toBe('Review [§skill:playwright:Playwright§] now')
  await userEvent.keyboard('next ')
  await expect
    .poll(() => store.get(agentComposerPromptAtom))
    .toBe('Review [§skill:playwright:Playwright§] next now')
  queryClient.clear()
})
