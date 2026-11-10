import type { UserAction } from '../../types'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { UserActionButtonType } from '../../types'
import UserActionItem from '../user-action'

const notify = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', () => ({ toast: { error: notify } }))
const prefix = 'workflowHumanInput.nodes.humanInput.userActions'
const initial: UserAction = {
  id: 'approve',
  title: 'Approve',
  button_style: UserActionButtonType.Primary,
}

function ActionOwner({ readonly = false }: { readonly?: boolean }) {
  const [action, setAction] = useState<UserAction | null>(initial)
  return (
    <>
      {action && (
        <UserActionItem
          data={action}
          onChange={setAction}
          onDelete={(id) => {
            if (id === action.id) setAction(null)
          }}
          readonly={readonly}
        />
      )}
      <output aria-label="Saved action">{JSON.stringify(action)}</output>
    </>
  )
}

beforeEach(async () => {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(1000, 600)
})

it('sanitizes identifiers, rejects invalid input, and keeps the identifier when editing the title', async () => {
  await render(<ActionOwner />)
  const identifier = page.getByRole('textbox', { name: `${prefix}.actionNamePlaceholder` })
  await identifier.fill('Approve action')
  await expect.element(identifier).toHaveValue('Approve_action')
  await identifier.fill('')
  await identifier.fill('1invalid')
  await expect.element(identifier).toHaveValue('')
  expect(notify).toHaveBeenLastCalledWith(`${prefix}.actionIdFormatTip`)
  await identifier.fill('averyveryveryverylongidentifier')
  await expect.element(identifier).toHaveValue('averyveryveryverylon')
  expect(notify).toHaveBeenLastCalledWith(`${prefix}.actionIdTooLong:{"maxLength":20}`)
  await page
    .getByRole('textbox', { name: `${prefix}.buttonTextPlaceholder` })
    .fill('Approve request')
  await expect.element(page.getByRole('status', { name: 'Saved action' })).toHaveTextContent(
    JSON.stringify({
      ...initial,
      id: 'averyveryveryverylon',
      title: 'Approve request',
    }),
  )
})

it('keeps the edited identifier through style changes and removes the matching action', async () => {
  const view = await render(<ActionOwner />)
  const identifier = page.getByRole('textbox', { name: `${prefix}.actionNamePlaceholder` })
  await identifier.fill('accept')
  await page.getByRole('button', { name: `Approve: ${prefix}.chooseStyle` }).click()
  await page.getByRole('radio', { name: `Approve, ${prefix}.buttonStyle.ghost` }).click()
  await expect.element(page.getByRole('status', { name: 'Saved action' })).toHaveTextContent(
    JSON.stringify({
      ...initial,
      id: 'accept',
      button_style: UserActionButtonType.Ghost,
    }),
  )
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('radiogroup')).not.toBeInTheDocument()
  await view.rerender(<ActionOwner readonly />)
  await expect.element(identifier).toBeDisabled()
  await expect
    .element(page.getByRole('textbox', { name: `${prefix}.buttonTextPlaceholder` }))
    .toBeDisabled()
  await expect
    .element(page.getByRole('button', { name: `Approve: ${prefix}.chooseStyle` }))
    .toBeDisabled()
  await expect
    .element(page.getByRole('button', { name: 'common.operation.delete' }))
    .not.toBeInTheDocument()
  await view.rerender(<ActionOwner />)
  await page.getByRole('button', { name: 'common.operation.delete' }).click()
  await expect.element(identifier).not.toBeInTheDocument()
  await expect.element(page.getByRole('status', { name: 'Saved action' })).toHaveTextContent('null')
})
