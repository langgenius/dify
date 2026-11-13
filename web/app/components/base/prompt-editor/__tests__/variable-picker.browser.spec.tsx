import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createTestQueryClient } from '@/test/query-client'
import PromptEditor from '../index'

const availableVariables: NodeOutPutVar[] = [
  {
    nodeId: 'start',
    title: 'Start',
    vars: [
      { variable: 'i', type: VarType.string },
      { variable: 'j', type: VarType.string },
      { variable: 'k', type: VarType.string },
    ],
  },
]

function VariablePickerEditor() {
  const [queryClient] = useState(() => {
    const client = createTestQueryClient()
    seedModelProviderQueries(client)
    return client
  })
  const [value, setValue] = useState('')

  return (
    <QueryClientProvider client={queryClient}>
      <ReactFlowProvider>
        <EventEmitterContextProvider>
          <PromptEditor
            aria-label="Form content"
            className="min-h-20"
            value={value}
            onChange={setValue}
            workflowVariableBlock={{
              show: true,
              variables: availableVariables,
              workflowNodesMap: { start: { title: 'Start', type: BlockEnum.Start } },
            }}
          />
          <output aria-label="Form value">{value}</output>
        </EventEmitterContextProvider>
      </ReactFlowProvider>
    </QueryClientProvider>
  )
}

async function openBracePicker() {
  await render(<VariablePickerEditor />)
  const editor = page.getByRole('textbox', { name: 'Form content' })
  await editor.click()
  await userEvent.keyboard('{{')
  await expect.element(page.getByText('i', { exact: true })).toBeVisible()
  await expect
    .element(page.getByRole('searchbox', { name: 'workflow.common.searchVar' }))
    .toBeVisible()
  await expect.element(editor).toHaveFocus()
  return editor
}

async function expectFormValue(text: string) {
  const value = page.getByRole('status', { name: 'Form value' })
  await expect.element(value).toBeInTheDocument()
  await expect.poll(() => value.element().textContent).toBe(text)
}

it('submits the default variable from the brace picker without adding a newline', async () => {
  const editor = await openBracePicker()
  await userEvent.keyboard('{Enter}')

  await expectFormValue('{{#start.i#}}')
  await expect.element(editor.getByText('i', { exact: true })).toBeVisible()
  await expect.element(page.getByRole('searchbox')).not.toBeInTheDocument()
  await expect.element(editor).toHaveFocus()
  await userEvent.keyboard(' continued')
  await expectFormValue('{{#start.i#}} continued')
})

it('submits the variable chosen with arrow keys in the brace picker', async () => {
  await openBracePicker()
  await userEvent.keyboard('{ArrowDown}')
  await userEvent.keyboard('{ArrowDown}')
  await userEvent.keyboard('{ArrowUp}')
  await userEvent.keyboard('{Enter}')

  await expectFormValue('{{#start.j#}}')
})

it('keeps the brace picker search field usable for filtering and submission', async () => {
  const editor = await openBracePicker()
  const search = page.getByRole('searchbox', { name: 'workflow.common.searchVar' })
  await search.fill('j')
  await expect.element(page.getByText('j', { exact: true })).toBeVisible()
  await expect.element(page.getByText('i', { exact: true })).not.toBeInTheDocument()
  await userEvent.keyboard('{Enter}')

  await expectFormValue('{{#start.j#}}')
  await expect.element(search).not.toBeInTheDocument()
  await expect.element(editor).toHaveFocus()
})

it('ignores composing navigation and Enter events in the brace picker', async () => {
  const editor = await openBracePicker()
  editor.element().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  for (const key of ['ArrowDown', 'Enter']) {
    editor
      .element()
      .dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true }),
      )
  }
  editor
    .element()
    .dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
  await expectFormValue('{')
  await expect.element(page.getByRole('searchbox')).toBeVisible()
  await userEvent.keyboard('{Enter}')

  await expectFormValue('{{#start.i#}}')
})

it('allows normal Enter editing after dismissing the brace picker', async () => {
  const editor = await openBracePicker()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('searchbox')).not.toBeInTheDocument()
  await expect.element(editor).toHaveFocus()
  await userEvent.keyboard('{Enter}')

  await expectFormValue('{\n')
})
