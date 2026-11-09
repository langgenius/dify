import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import PromptEditor from '../index'

function ClassEditors() {
  const [classes, setClasses] = useState([
    { id: 'first', value: '' },
    { id: 'second', value: '' },
  ])
  const [activeClass, setActiveClass] = useState<number | null>(null)

  return (
    <EventEmitterContextProvider>
      {classes.map(({ id, value }, index) => (
        <section key={id} aria-label={`Class ${index + 1}`}>
          <PromptEditor
            aria-label={`Class ${index + 1} description`}
            className="min-h-14"
            instanceId={id}
            value={value}
            workflowVariableBlock={{
              show: true,
              workflowNodesMap: {},
              variables: [],
            }}
            onChange={(text) =>
              setClasses((current) =>
                current.map((item) => (item.id === id ? { ...item, value: text } : item)),
              )
            }
            onFocus={() => setActiveClass(index)}
            onBlur={() => setActiveClass(null)}
          />
        </section>
      ))}
      <output aria-label="Selected class">
        {activeClass === null ? 'None' : `Class ${activeClass + 1}`}
      </output>
      <button type="button">Outside class editors</button>
    </EventEmitterContextProvider>
  )
}

// Native selection transfer between real controlled Lexical roots must not refocus the
// previous class. The classifier owner tests replace these editors with input shims.
it('moves selection and text entry between class descriptions after editing', async () => {
  await render(<ClassEditors />)
  const first = page.getByRole('textbox', { name: 'Class 1 description' })
  const second = page.getByRole('textbox', { name: 'Class 2 description' })
  const selection = page.getByRole('status', { name: 'Selected class' })

  await first.click()
  await userEvent.keyboard('First class')
  await expect.element(first).toHaveTextContent('First class')

  await second.click()
  await expect.element(second).toHaveFocus()
  await expect.element(selection).toHaveTextContent('Class 2')
  await userEvent.keyboard('Second class')
  await expect.element(second).toHaveTextContent('Second class')
  await expect.element(first).toHaveTextContent('First class')

  await first.click()
  await expect.element(first).toHaveFocus()
  await expect.element(selection).toHaveTextContent('Class 1')

  await page.getByRole('button', { name: 'Outside class editors' }).click()
  await expect.element(selection).toHaveTextContent('None')
})
