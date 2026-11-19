import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { datasets } from './datasets'
import { ContextEditor } from './editor-fixture'

it('keeps ordinary and partial text editable and turns a completed placeholder into usable context', async () => {
  await render(<ContextEditor datasets={datasets} />)
  const editor = page.getByRole('textbox', { name: 'Prompt' })
  await editor.fill('Before {{#contex')
  await expect.element(editor).toHaveTextContent('Before {{#contex')
  await expect
    .element(page.getByRole('button', { name: 'common.promptEditor.context.item.title' }))
    .not.toBeInTheDocument()
  await userEvent.keyboard('t#}} After')
  const trigger = page.getByRole('button', { name: 'common.promptEditor.context.item.title' })
  await expect.element(trigger).toHaveTextContent('2')
  await expect
    .element(page.getByRole('status', { name: 'Saved prompt' }))
    .toHaveTextContent('Before {{#context#}} After')
  await trigger.click()
  await expect.element(page.getByText('Dataset A')).toBeVisible()
  await expect.element(page.getByText('Dataset B')).toBeVisible()
})

it('uses updated datasets and restrictions for subsequent placeholder replacements', async () => {
  const screen = await render(<ContextEditor />)
  const editor = page.getByRole('textbox', { name: 'Prompt' })
  await editor.fill('{{#context#}}')
  const trigger = page.getByRole('button', { name: 'common.promptEditor.context.item.title' })
  await expect.element(trigger).toHaveTextContent('0')
  await screen.rerender(
    <ContextEditor datasets={[{ id: 'new', name: 'Updated context', type: 'text' }]} />,
  )
  await editor.fill('{{#context#}}')
  await expect.element(trigger).toHaveTextContent('1')
  await trigger.click()
  await expect.element(page.getByText('Updated context')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByText('Updated context')).not.toBeInTheDocument()
  await screen.rerender(<ContextEditor datasets={datasets} canNotAddContext />)
  await editor.fill('{{#context#}}')
  await expect
    .element(page.getByText('common.promptEditor.context.item.title', { exact: true }))
    .toBeVisible()
  await expect.element(trigger).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'Saved prompt' }))
    .toHaveTextContent('{{#context#}}')
})
