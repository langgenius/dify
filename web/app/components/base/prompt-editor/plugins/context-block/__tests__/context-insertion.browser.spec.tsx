import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { datasets } from './datasets'
import { ContextEditor } from './editor-fixture'

it('inserts a context token with usable dataset details and deletes it from the prompt', async () => {
  await render(<ContextEditor datasets={datasets} />)
  await page.getByRole('textbox', { name: 'Prompt' }).click()
  await page.getByRole('button', { name: 'Insert context' }).click()
  const trigger = page.getByRole('button', { name: 'common.promptEditor.context.item.title' })
  await expect.element(trigger).toHaveTextContent('2')
  await expect
    .element(page.getByRole('status', { name: 'Saved prompt' }))
    .toHaveTextContent('{{#context#}}')
  await trigger.click()
  await expect.element(page.getByText('Dataset A')).toBeVisible()
  await expect.element(page.getByText('Dataset B')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByText('Dataset A')).not.toBeInTheDocument()
  // Select the rendered chip, then let Lexical process the native deletion key.
  await page.getByText('common.promptEditor.context.item.title', { exact: true }).click()
  await userEvent.keyboard('{Backspace}')
  await expect.element(trigger).not.toBeInTheDocument()
  await expect.element(page.getByRole('status', { name: 'Saved prompt' })).toHaveTextContent('')
})

it('retains the context token while omitting dataset actions for restricted prompts', async () => {
  await render(<ContextEditor datasets={datasets} canNotAddContext />)
  await page.getByRole('textbox', { name: 'Prompt' }).click()
  await page.getByRole('button', { name: 'Insert context' }).click()
  await expect
    .element(page.getByText('common.promptEditor.context.item.title', { exact: true }))
    .toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'common.promptEditor.context.item.title' }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'Saved prompt' }))
    .toHaveTextContent('{{#context#}}')
})
