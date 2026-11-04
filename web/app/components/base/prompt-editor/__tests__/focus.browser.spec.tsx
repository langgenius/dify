import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { page, server, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createTestQueryClient } from '@/test/query-client'
import PromptEditor from '../index'

const initialPrompts = {
  System: 'System instruction',
  User: 'User question',
  Assistant: '',
}
const availableVariables: NodeOutPutVar[] = [
  {
    nodeId: 'source',
    title: 'Source',
    vars: [
      { variable: 'answer', type: VarType.string },
      { variable: 'result', type: VarType.string },
    ],
  },
]
const modifier = server.platform === 'darwin' ? 'Meta' : 'Control'

function PromptFields({
  values = initialPrompts,
  clipboardText = '',
  sourceTitle = 'Source',
  variablesInitiallyEnabled = true,
}: {
  values?: typeof initialPrompts
  clipboardText?: string
  sourceTitle?: string
  variablesInitiallyEnabled?: boolean
}) {
  const [queryClient] = useState(() => {
    const client = createTestQueryClient()
    seedModelProviderQueries(client)
    return client
  })
  const [prompts, setPrompts] = useState(values)
  const [focusedPrompt, setFocusedPrompt] = useState<string | null>(null)
  const [variablesEnabled, setVariablesEnabled] = useState(variablesInitiallyEnabled)

  return (
    <QueryClientProvider client={queryClient}>
      <ReactFlowProvider>
        <EventEmitterContextProvider>
          {Object.entries(prompts).map(([role, value]) => (
            <div key={role}>
              <PromptEditor
                aria-label={`${role} prompt`}
                value={value}
                onChange={(text) => setPrompts((current) => ({ ...current, [role]: text }))}
                onFocus={() => setFocusedPrompt(role)}
                onBlur={() => setFocusedPrompt(null)}
                workflowVariableBlock={{
                  show: variablesEnabled,
                  variables: availableVariables,
                  workflowNodesMap: { source: { title: sourceTitle, type: BlockEnum.Start } },
                }}
              />
              <output aria-label={`${role} value`}>{value}</output>
            </div>
          ))}
          <div>
            <output aria-label="Focused prompt">{focusedPrompt ?? 'None'}</output>
          </div>
          <button type="button">Outside action</button>
          {!variablesInitiallyEnabled && (
            <button
              type="button"
              aria-pressed={variablesEnabled}
              onClick={() => setVariablesEnabled(true)}
            >
              Enable variables
            </button>
          )}
          <textarea aria-label="Clipboard source" value={clipboardText} readOnly />
        </EventEmitterContextProvider>
      </ReactFlowProvider>
    </QueryClientProvider>
  )
}

async function copyPlainText() {
  await page.getByRole('textbox', { name: 'Clipboard source' }).click()
  await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`)
  await userEvent.copy()
}

async function expectPromptValue(role: keyof typeof initialPrompts, text: string) {
  const value = page.getByRole('status', { name: `${role} value` })
  await expect.element(value).toBeInTheDocument()
  await expect.poll(() => value.element().textContent).toBe(text)
}

// Native contenteditable selection and blur ordering determine whether Lexical steals focus back.
it('moves focus from the system prompt to other prompts and outside controls', async () => {
  await render(<PromptFields />)
  const system = page.getByRole('textbox', { name: 'System prompt' })
  const user = page.getByRole('textbox', { name: 'User prompt' })
  const assistant = page.getByRole('textbox', { name: 'Assistant prompt' })
  const outside = page.getByRole('button', { name: 'Outside action' })

  await system.click()
  await userEvent.keyboard('{End}')
  await user.click()
  await expect.element(user).toHaveFocus()
  await userEvent.keyboard('{End} updated')
  await expect.element(user).toHaveTextContent('User question updated')
  await expect.element(system).toHaveTextContent('System instruction')

  await assistant.click()
  await expect.element(assistant).toHaveFocus()
  await userEvent.keyboard('Assistant answer')
  await expect.element(assistant).toHaveTextContent('Assistant answer')

  await system.click()
  await expect.element(system).toHaveFocus()
  await outside.click()
  await expect.element(outside).toHaveFocus()
})

// These scenarios exercise native selection, clipboard events, and history through the real editor.
it('inserts a workflow variable from the picker and continues typing at the insertion point', async () => {
  await render(<PromptFields />)
  const user = page.getByRole('textbox', { name: 'User prompt' })

  await page.getByRole('textbox', { name: 'System prompt' }).click()
  await user.click()
  await expect.element(user).toHaveFocus()
  await userEvent.keyboard('{Home}{ArrowRight>5/}/')
  await expect.element(page.getByText('answer', { exact: true })).toBeVisible()
  await userEvent.keyboard('{Enter}')

  await expect.element(user.getByText('answer', { exact: true })).toBeVisible()
  await expectPromptValue('User', 'User {{#source.answer#}}question')
  await expect.element(user).toHaveFocus()
  await userEvent.keyboard('next ')
  await expectPromptValue('User', 'User {{#source.answer#}}next question')
  await expectPromptValue('System', 'System instruction')

  await page.getByRole('button', { name: 'Outside action' }).click()
  await expect.element(page.getByRole('button', { name: 'Outside action' })).toHaveFocus()
})

it('pastes multiline text with variables over the selection and preserves the typing position', async () => {
  const pastedText = 'Before {{#source.answer#}} and {{#source.result#}}\nAfter'
  await render(<PromptFields clipboardText={pastedText} />)
  const user = page.getByRole('textbox', { name: 'User prompt' })

  await copyPlainText()
  await user.click()
  await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`)
  await userEvent.paste()

  await expect.element(user.getByText('answer', { exact: true })).toBeVisible()
  await expect.element(user.getByText('result', { exact: true })).toBeVisible()
  await expectPromptValue('User', pastedText)
  await expect.element(user).toHaveFocus()
  await userEvent.keyboard(' continued')
  await expectPromptValue('User', `${pastedText} continued`)
  await expectPromptValue('System', 'System instruction')
})

it('copies rendered workflow variables between prompts without changing their serialized values', async () => {
  const sourceText = 'Before {{#source.answer#}} and {{#source.result#}} after'
  await render(<PromptFields values={{ ...initialPrompts, System: sourceText }} />)
  const system = page.getByRole('textbox', { name: 'System prompt' })
  const assistant = page.getByRole('textbox', { name: 'Assistant prompt' })

  await expect.element(system.getByText('answer', { exact: true })).toBeVisible()
  await system.click()
  await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`)
  await userEvent.copy()
  await assistant.click()
  await expect.element(assistant).toHaveFocus()
  await userEvent.paste()

  await expect.element(assistant.getByText('answer', { exact: true })).toBeVisible()
  await expect.element(assistant.getByText('result', { exact: true })).toBeVisible()
  await expectPromptValue('Assistant', sourceText)
  await expectPromptValue('System', sourceText)
  await expect.element(assistant).toHaveFocus()
  await userEvent.keyboard(' continued')
  await expectPromptValue('Assistant', `${sourceText} continued`)
})

it('undoes and redoes variable insertion within the active prompt', async () => {
  const insertedText = '{{#source.answer#}}'
  await render(<PromptFields />)
  const assistant = page.getByRole('textbox', { name: 'Assistant prompt' })

  await assistant.click()
  await userEvent.keyboard('/')
  await expect.element(page.getByText('answer', { exact: true })).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expectPromptValue('Assistant', insertedText)

  await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
  await expectPromptValue('Assistant', '/')
  await expect.element(assistant.getByText('answer', { exact: true })).not.toBeInTheDocument()
  await expect.element(assistant).toHaveFocus()
  await userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`)
  await expectPromptValue('Assistant', insertedText)
  await expect.element(assistant.getByText('answer', { exact: true })).toBeVisible()
  await expect.element(assistant).toHaveFocus()
  await expectPromptValue('System', 'System instruction')
  await expectPromptValue('User', 'User question')
})

it('uses updated configuration for paste without stealing focus or adding undo steps', async () => {
  const pastedText = ' {{#source.result#}}'
  const screen = await render(<PromptFields clipboardText=" updated" />)
  const user = page.getByRole('textbox', { name: 'User prompt' })
  const outside = page.getByRole('button', { name: 'Outside action' })

  await copyPlainText()
  await user.click()
  await userEvent.keyboard('{End}')
  // Pasting gives each edit an explicit undo boundary independent of typing coalescence.
  await userEvent.paste()
  await expectPromptValue('User', 'User question updated')
  await outside.click()
  await expect.element(outside).toHaveFocus()

  await screen.rerender(<PromptFields clipboardText={pastedText} sourceTitle="Renamed source" />)
  await expect.element(outside).toHaveFocus()
  await expectPromptValue('User', 'User question updated')

  await copyPlainText()
  await user.click()
  await expect.element(user).toHaveFocus()
  await userEvent.keyboard('{End}')
  await userEvent.paste()
  await expect.element(user.getByText('Renamed source', { exact: true })).toBeVisible()
  await expect.element(user.getByText('result', { exact: true })).toBeVisible()
  await expectPromptValue('User', `User question updated${pastedText}`)
  await expect.element(user).toHaveFocus()

  await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
  await expectPromptValue('User', 'User question updated')
  await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
  await expectPromptValue('User', 'User question')
  await userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`)
  await expectPromptValue('User', 'User question updated')
  await userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`)
  await expectPromptValue('User', `User question updated${pastedText}`)
  await expect.element(user.getByText('Renamed source', { exact: true })).toBeVisible()
  await expect.element(user).toHaveFocus()
})

// Registering the plugin after editing must convert existing tokens without restoring its old selection.
it('enables workflow variables on an existing editor without taking focus from the activating control', async () => {
  const text = 'User {{#source.answer#}} prompt'
  await render(
    <PromptFields values={{ ...initialPrompts, User: text }} variablesInitiallyEnabled={false} />,
  )
  const user = page.getByRole('textbox', { name: 'User prompt' })
  const enable = page.getByRole('button', { name: 'Enable variables' })

  await expect.element(user.getByText('answer', { exact: true })).not.toBeInTheDocument()
  await user.click()
  await userEvent.keyboard('{End}')
  await expect.element(user).toHaveFocus()
  await enable.click()
  await expect.element(enable).toHaveAttribute('aria-pressed', 'true')

  await expect.element(user.getByText('answer', { exact: true })).toBeVisible()
  await expect.element(enable).toHaveFocus()
  await expectPromptValue('User', text)

  await user.click()
  await expect.element(user).toHaveFocus()
  await userEvent.keyboard('{End} continued')
  await expectPromptValue('User', `${text} continued`)
  await expectPromptValue('System', 'System instruction')
})
