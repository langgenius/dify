import { detectPlatform } from '@tanstack/react-hotkeys'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { SHORTCUTS_EMPTY_CONTENT } from '../index'
import { PopupEditor } from './editor-fixture'

const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
const shortcut = (key = '/') => `{${modifier}>}${key}{/${modifier}}`
const actions = () => page.getByRole('region', { name: 'Prompt actions' })
const editor = () => page.getByRole('textbox', { name: 'Prompt' })

it('opens only for the configured editor shortcut and dismisses with Escape', async () => {
  await render(<PopupEditor hotkey="Mod+K" withActions={false} />)
  await page.getByRole('textbox', { name: 'Outside' }).click()
  await userEvent.keyboard(shortcut('k'))
  await expect.element(page.getByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
  await editor().fill('Prompt text')
  await userEvent.keyboard(shortcut())
  await expect.element(page.getByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
  await userEvent.keyboard(`{${modifier}>}{Alt>}k{/Alt}{/${modifier}}`)
  await expect.element(page.getByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
  await userEvent.keyboard(shortcut('k'))
  await expect.element(page.getByText(SHORTCUTS_EMPTY_CONTENT)).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByText(SHORTCUTS_EMPTY_CONTENT)).not.toBeInTheDocument()
})

it.each([true, false])(
  'keeps insertion operable at the native caret with a container: %s',
  async (withContainer) => {
    await render(<PopupEditor withContainer={withContainer} />)
    await editor().fill('Before After')
    await userEvent.keyboard(
      '{Home}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}',
    )
    await userEvent.keyboard(shortcut())
    await expect.element(actions()).toBeVisible()
    const insert = actions().getByRole('button', { name: 'Insert', exact: true })
    await insert.click()
    await expect.element(editor()).toHaveTextContent('Before inserted textAfter')
    await expect.element(actions()).not.toBeInTheDocument()
  },
)

it('keeps prompt actions operable after the native DOM selection is cleared', async () => {
  await render(<PopupEditor withContainer={false} />)
  await editor().fill('Prompt text')
  await userEvent.keyboard('{End}{ArrowLeft}{ArrowRight}')
  window.getSelection()!.removeAllRanges()
  await expect.element(editor()).toHaveFocus()
  await userEvent.keyboard(shortcut())
  await expect.element(actions()).toBeVisible()
  await actions().getByRole('button', { name: 'Close actions' }).click()
  await expect.element(actions()).not.toBeInTheDocument()
})

it('keeps a real nested portal open until its own Escape and returns to the editor after popup Escape', async () => {
  await render(<PopupEditor />)
  await editor().fill('Prompt text')
  await userEvent.keyboard(shortcut())
  await expect.element(actions()).toBeVisible()
  await actions().getByRole('button', { name: 'Details' }).click()
  const nested = page.getByRole('button', { name: 'Nested action' })
  await expect.element(nested).toBeVisible()
  await nested.click()
  await expect.element(actions()).toBeVisible()
  await expect.element(nested).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(nested).not.toBeInTheDocument()
  await expect.element(actions()).toBeVisible()
  await expect.element(actions().getByRole('button', { name: 'Details' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(actions()).not.toBeInTheDocument()
  await expect.element(editor()).toHaveFocus()
})

it('closes through its child action or a native outside click and can reopen', async () => {
  await render(<PopupEditor />)
  await editor().fill('Prompt text')
  await userEvent.keyboard(shortcut())
  await expect.element(actions()).toBeVisible()
  await actions().getByRole('button', { name: 'Close actions' }).click()
  await expect.element(actions()).not.toBeInTheDocument()
  await editor().click()
  await userEvent.keyboard(shortcut())
  await expect.element(actions()).toBeVisible()
  await page.getByRole('textbox', { name: 'Outside' }).click()
  await expect.element(actions()).not.toBeInTheDocument()
})

it('keeps panel-adjacent actions inside the viewport and clear of the workflow panel', async () => {
  await page.viewport(1200, 900)
  await render(
    <>
      <aside
        aria-label="Workflow panel"
        data-workflow-right-panel
        style={{ position: 'fixed', right: 0, top: 56, bottom: 8, width: 400, background: 'white' }}
      >
        Workflow settings
      </aside>
      <PopupEditor withContainer={false} displayMode="workflow-panel-adjacent-center" />
    </>,
  )
  await editor().fill('Prompt text')
  await userEvent.keyboard(shortcut())
  await expect.element(actions()).toBeVisible()
  const popup = actions().element().getBoundingClientRect()
  const panel = page
    .getByRole('complementary', { name: 'Workflow panel' })
    .element()
    .getBoundingClientRect()
  expect(popup.left).toBeGreaterThanOrEqual(0)
  expect(popup.right).toBeLessThanOrEqual(panel.left)
  expect(popup.top).toBeGreaterThanOrEqual(0)
  expect(popup.bottom).toBeLessThanOrEqual(window.innerHeight)
  await actions().getByRole('button', { name: 'Insert', exact: true }).click()
  await expect.element(editor()).toHaveTextContent('Prompt textinserted text')
  await expect.element(actions()).not.toBeInTheDocument()
})
