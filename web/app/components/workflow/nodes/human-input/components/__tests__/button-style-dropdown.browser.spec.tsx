import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { UserActionButtonType } from '../../types'
import ButtonStyleDropdown from '../button-style-dropdown'

const prefix = 'workflowHumanInput.nodes.humanInput.userActions'
function StyleOwner({ readonly = false }: { readonly?: boolean }) {
  const [style, setStyle] = useState<UserActionButtonType>(UserActionButtonType.Ghost)
  return <ButtonStyleDropdown text="Approve" data={style} onChange={setStyle} readonly={readonly} />
}

beforeEach(async () => {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(800, 600)
})

it('keeps the keyboard-selected style after closing and reopening the picker', async () => {
  await render(<StyleOwner />)
  const trigger = page.getByRole('button', { name: `Approve: ${prefix}.chooseStyle` })
  await userEvent.tab()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const ghost = page.getByRole('radio', { name: `Approve, ${prefix}.buttonStyle.ghost` })
  await expect.element(ghost).toBeChecked()
  await ghost.click()
  await userEvent.keyboard('{ArrowRight}')
  const primary = page.getByRole('radio', { name: `Approve, ${prefix}.buttonStyle.primary` })
  await expect.element(primary).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(primary).toBeChecked()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('radiogroup')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(primary).toBeChecked()
})

it('keeps the style picker unavailable in readonly mode', async () => {
  await render(<StyleOwner readonly />)
  await expect
    .element(page.getByRole('button', { name: `Approve: ${prefix}.chooseStyle` }))
    .toBeDisabled()
  await userEvent.tab()
  await expect.element(page.getByRole('radiogroup')).not.toBeInTheDocument()
})
