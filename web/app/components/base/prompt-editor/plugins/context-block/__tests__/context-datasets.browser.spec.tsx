import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ContextEditor } from './editor-fixture'

it('updates and clears the datasets of an existing context block through public dataset events', async () => {
  await render(<ContextEditor />)
  await page.getByRole('textbox', { name: 'Prompt' }).fill('{{#context#}}')
  const trigger = page.getByRole('button', { name: 'common.promptEditor.context.item.title' })
  await expect.element(trigger).toHaveTextContent('0')
  await page.getByRole('button', { name: 'Update datasets' }).click()
  await expect.element(trigger).toHaveTextContent('2')
  await trigger.click()
  await expect.element(page.getByText('Dataset A')).toBeVisible()
  await expect.element(page.getByText('Dataset B')).toBeVisible()
  await page.getByRole('button', { name: 'Clear datasets' }).click()
  await expect.element(trigger).toHaveTextContent('0')
  await trigger.click()
  await expect
    .element(page.getByText('common.promptEditor.context.modal.title:{"num":0}'))
    .toBeVisible()
  await expect.element(page.getByText('Dataset A')).not.toBeInTheDocument()
})

it('keeps the selected datasets after an unrelated application event', async () => {
  await render(<ContextEditor />)
  await page.getByRole('textbox', { name: 'Prompt' }).fill('{{#context#}}')
  await page.getByRole('button', { name: 'Update datasets' }).click()
  const trigger = page.getByRole('button', { name: 'common.promptEditor.context.item.title' })
  await expect.element(trigger).toHaveTextContent('2')
  await page.getByRole('button', { name: 'Unrelated event' }).click()
  await trigger.click()
  await expect.element(page.getByText('Dataset A')).toBeVisible()
  await expect.element(page.getByText('Dataset B')).toBeVisible()
})
