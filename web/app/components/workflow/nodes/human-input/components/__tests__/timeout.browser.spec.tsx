import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import TimeoutInput from '../timeout'

function TimeoutOwner({
  initial = 3,
  unit = 'day',
  readonly = false,
}: {
  initial?: number
  unit?: 'day' | 'hour'
  readonly?: boolean
}) {
  const [value, setValue] = useState({ timeout: initial, unit })
  return (
    <>
      <TimeoutInput {...value} onChange={setValue} readonly={readonly} />
      <output aria-label="Saved timeout">{JSON.stringify(value)}</output>
    </>
  )
}

beforeEach(async () => {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(800, 600)
})

it('keeps the keyboard-edited timeout when switching units', async () => {
  await render(<TimeoutOwner />)
  const input = page.getByRole('textbox', { name: 'workflow.nodes.humanInput.timeout.title' })
  await input.click()
  await userEvent.keyboard('{ArrowUp}')
  await expect.element(input).toHaveValue('4')
  await page
    .getByRole('radio', { name: 'workflowHumanInput.nodes.humanInput.timeout.hours' })
    .click()
  await expect.element(input).toHaveValue('4')
  await expect
    .element(page.getByRole('status', { name: 'Saved timeout' }))
    .toHaveTextContent('{"timeout":4,"unit":"hour"}')
  await expect
    .element(page.getByRole('radio', { name: 'workflowHumanInput.nodes.humanInput.timeout.hours' }))
    .toBeChecked()
})

it('falls back to 1 when cleared and preserves the value in read-only mode', async () => {
  const view = await render(<TimeoutOwner initial={5} unit="hour" />)
  const input = page.getByRole('textbox', { name: 'workflow.nodes.humanInput.timeout.title' })
  await input.fill('')
  await userEvent.tab()
  await expect.element(input).toHaveValue('1')
  await view.rerender(<TimeoutOwner initial={5} unit="hour" readonly />)
  await expect.element(input).toBeDisabled()
  await expect.element(input).toHaveValue('1')
  await expect
    .element(page.getByRole('radio', { name: 'workflowHumanInput.nodes.humanInput.timeout.days' }))
    .toBeDisabled()
  await expect
    .element(page.getByRole('radio', { name: 'workflowHumanInput.nodes.humanInput.timeout.hours' }))
    .toBeChecked()
})

it('rounds a fractional timeout before keeping it through a unit change', async () => {
  await render(<TimeoutOwner unit="hour" />)
  const input = page.getByRole('textbox', { name: 'workflow.nodes.humanInput.timeout.title' })
  await input.fill('1.5')
  await userEvent.tab()
  await expect.element(input).toHaveValue('2')
  await page
    .getByRole('radio', { name: 'workflowHumanInput.nodes.humanInput.timeout.days' })
    .click()
  await expect.element(input).toHaveValue('2')
  await expect
    .element(page.getByRole('status', { name: 'Saved timeout' }))
    .toHaveTextContent('{"timeout":2,"unit":"day"}')
  await expect
    .element(page.getByRole('radio', { name: 'workflowHumanInput.nodes.humanInput.timeout.days' }))
    .toBeChecked()
})

it('normalizes an imported fractional timeout when switching units', async () => {
  await render(<TimeoutOwner initial={1.5} unit="hour" />)
  await page
    .getByRole('radio', { name: 'workflowHumanInput.nodes.humanInput.timeout.days' })
    .click()
  await expect
    .element(page.getByRole('textbox', { name: 'workflow.nodes.humanInput.timeout.title' }))
    .toHaveValue('2')
  await expect
    .element(page.getByRole('status', { name: 'Saved timeout' }))
    .toHaveTextContent('{"timeout":2,"unit":"day"}')
  await expect
    .element(page.getByRole('radio', { name: 'workflowHumanInput.nodes.humanInput.timeout.days' }))
    .toBeChecked()
})
