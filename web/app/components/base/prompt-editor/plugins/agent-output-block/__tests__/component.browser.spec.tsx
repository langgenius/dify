import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { OutputEditor } from './test-helpers'

it('restores an open type picker without committing the output on focus transfer', async () => {
  const onChange = vi.fn()
  await render(<OutputEditor openTypeSelectOnEdit selectNameOnEdit={false} onChange={onChange} />)
  await expect
    .element(page.getByRole('combobox', { name: 'workflowAgent.nodes.agent.outputVars.typeLabel' }))
    .toHaveAttribute('aria-expanded', 'true')
  await expect.element(page.getByRole('option', { name: 'file', exact: true })).toBeVisible()
  expect(onChange).not.toHaveBeenCalled()
})

it('commits on Enter and returns focus to the editor', async () => {
  const onChange = vi.fn()
  await render(<OutputEditor onChange={onChange} />)
  const input = page.getByRole('textbox', {
    name: 'workflowAgent.nodes.agent.outputVars.nameLabel',
  })
  await input.fill('summary')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveFocus()
  expect(onChange).toHaveBeenCalledWith(
    [expect.objectContaining({ name: 'summary', type: 'string' })],
    'Generate [§output:summary:summary§] after',
  )
})
