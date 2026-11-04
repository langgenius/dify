import type { Recipient } from '../../../../types'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import EmailInput from '../email-input'
import { members } from './recipient-test-data'

function Caller({ initial = [], disabled = false }: { initial?: Recipient[]; disabled?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <EmailInput
        email="owner@example.com"
        value={value}
        list={members}
        onAdd={(email) => setValue((previous) => [...previous, { type: 'external', email }])}
        onSelect={(user_id) => setValue((previous) => [...previous, { type: 'member', user_id }])}
        onDelete={(recipient) =>
          setValue((previous) => previous.filter((item) => item !== recipient))
        }
        disabled={disabled}
      />
      <button type="button">Save</button>
      <output aria-label="Recipients">{JSON.stringify(value)}</output>
    </>
  )
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})

it('selects an unselected suggestion, updates its chip and returns focus to typing', async () => {
  await render(<Caller initial={[{ type: 'member', user_id: 'member-1' }]} />)
  const input = page.getByRole('textbox')
  await expect.element(input).toHaveAttribute('placeholder', '')
  await input.click()
  await expect
    .element(input)
    .toHaveAttribute(
      'placeholder',
      'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.placeholder',
    )
  await input.fill('member')
  await expect.element(page.getByRole('button', { name: /Member One/ })).toBeDisabled()
  await page.getByRole('button', { name: /Member Two/ }).click()
  await expect.element(page.getByText('member-2@example.com', { exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: /Member Two/ })).not.toBeInTheDocument()
  await expect.element(input).toHaveFocus()
  await expect.element(page.getByRole('status', { name: 'Recipients' })).toHaveTextContent(
    JSON.stringify([
      { type: 'member', user_id: 'member-1' },
      { type: 'member', user_id: 'member-2' },
    ]),
  )
})

it('commits member and external addresses with native separators and rejects duplicates and invalid blur', async () => {
  await render(<Caller initial={[{ type: 'external', email: 'existing@example.com' }]} />)
  const input = page.getByRole('textbox')
  await input.fill('member-2@example.com')
  await userEvent.keyboard(',')
  await expect.element(input).toHaveValue('')
  await expect.element(page.getByText('member-2@example.com', { exact: true })).toBeVisible()
  await input.fill('new@example.com')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('new@example.com', { exact: true })).toBeVisible()
  await input.fill('existing@example.com')
  await userEvent.tab()
  await expect.element(page.getByRole('button', { name: 'Save' })).toHaveFocus()
  await input.fill('bad-email')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.element(page.getByRole('status', { name: 'Recipients' })).toHaveTextContent(
    JSON.stringify([
      { type: 'external', email: 'existing@example.com' },
      { type: 'member', user_id: 'member-2' },
      { type: 'external', email: 'new@example.com' },
    ]),
  )
})

it.each(['', 'bad-email', 'existing@example.com', 'new@example.com'])(
  'Tab leaves "%s" and commits a valid address only once across keydown and blur',
  async (value) => {
    const initial: Recipient[] = [{ type: 'external', email: 'existing@example.com' }]
    await render(<Caller initial={initial} />)
    await page.getByRole('textbox').fill(value)
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'Save' })).toHaveFocus()
    await expect
      .element(page.getByRole('status', { name: 'Recipients' }))
      .toHaveTextContent(
        JSON.stringify(
          value === 'new@example.com' ? [...initial, { type: 'external', email: value }] : initial,
        ),
      )
  },
)

it('keeps typing focused and isolates native keys from workflow listeners', async () => {
  const onParentKeyDown = vi.fn()
  const onWindowKeyDown = vi.fn()
  window.addEventListener('keydown', onWindowKeyDown)
  onTestFinished(() => window.removeEventListener('keydown', onWindowKeyDown))
  await render(
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Passive harness observes bubbling keys without adding a focusable control to the recipient UI.
    <section aria-label="Workflow keyboard boundary" onKeyDown={onParentKeyDown}>
      <Caller />
    </section>,
  )
  await page.getByRole('textbox').click()
  await userEvent.keyboard('a')
  await expect.element(page.getByRole('textbox')).toHaveValue('a')
  await expect.element(page.getByRole('textbox')).toHaveFocus()
  expect(onParentKeyDown).not.toHaveBeenCalled()
  expect(onWindowKeyDown).not.toHaveBeenCalled()
})

it('Backspace removes an unavailable member and readonly prop changes remove the input', async () => {
  const screen = await render(<Caller initial={[{ type: 'member', user_id: 'missing-member' }]} />)
  await expect
    .element(page.getByRole('status', { name: 'Recipients' }))
    .toHaveTextContent('[{"type":"member","user_id":"missing-member"}]')
  await page.getByRole('textbox').click()
  await userEvent.keyboard('{Backspace}')
  await expect.element(page.getByRole('status', { name: 'Recipients' })).toHaveTextContent('[]')
  await screen.rerender(<Caller disabled />)
  await expect.element(page.getByRole('textbox')).not.toBeInTheDocument()
})
