import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import InstructionEditor from '../instruction-editor'
import { GeneratorType } from '../types'

const common = {
  availableVars: [],
  availableNodes: [],
  isShowCurrentBlock: false,
  isShowLastRunBlock: false,
}

it('edits instructions through the real prompt editor', async () => {
  const onChange = vi.fn()
  function Editor() {
    const [value, setValue] = useState('')
    return (
      <InstructionEditor
        {...common}
        editorKey="prompt"
        generatorType={GeneratorType.prompt}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }
  await render(
    <EventEmitterContextProvider>
      <Editor />
    </EventEmitterContextProvider>,
  )
  const editor = page.getByRole('textbox', { name: 'appGeneration.generate.instruction' })
  await editor.fill('Updated instruction')
  await expect.poll(() => onChange.mock.lastCall?.[0]).toBe('Updated instruction')
  await expect.element(editor).toHaveTextContent('Updated instruction')
})

it('inserts context into the matching editor instance', async () => {
  await render(
    <EventEmitterContextProvider>
      <div id="first-label">First instruction</div>
      <InstructionEditor
        {...common}
        aria-labelledby="first-label"
        editorKey="first"
        generatorType={GeneratorType.prompt}
        value=""
        onChange={vi.fn()}
      />
      <div id="second-label">Second instruction</div>
      <InstructionEditor
        {...common}
        aria-labelledby="second-label"
        editorKey="second"
        generatorType={GeneratorType.code}
        value=""
        onChange={vi.fn()}
      />
    </EventEmitterContextProvider>,
  )
  await page
    .getByRole('button', { name: /generate\.insertContext/ })
    .nth(1)
    .click()
  await expect
    .element(page.getByRole('textbox', { name: 'Second instruction' }))
    .toHaveTextContent('/')
  await expect
    .element(page.getByRole('textbox', { name: 'First instruction' }))
    .not.toHaveTextContent('/')
})
