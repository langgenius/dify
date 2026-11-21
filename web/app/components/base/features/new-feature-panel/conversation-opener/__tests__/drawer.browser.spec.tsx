import { DrawerTitle } from '@langgenius/dify-ui/drawer'
import { page, userEvent } from 'vite-plus/test/browser'
import { renderFeature } from '../../__tests__/feature-browser-test-env'
import { FeaturePanelDrawer } from '../../feature-panel-drawer'
import ConversationOpener from '../index'

vi.unmock('react-i18next')

it('returns keyboard focus to the edit button in the open drawer after Escape', async () => {
  const onClose = vi.fn()
  await renderFeature(
    <FeaturePanelDrawer show onClose={onClose}>
      <DrawerTitle>Features</DrawerTitle>
      <ConversationOpener />
    </FeaturePanelDrawer>,
    { opening: { enabled: true, opening_statement: 'Hi there' } },
  )
  const drawer = page.getByRole('dialog', { name: 'Features' })
  const edit = drawer.getByRole('button', { name: 'Edit opener' })
  await expect.element(drawer).toBeVisible()
  ;(drawer.getByRole('switch').element() as HTMLElement).focus()
  await userEvent.keyboard('{Tab}')
  await expect.element(edit).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const editor = page.getByRole('dialog', { name: 'Conversation Opener' })
  await expect.element(editor).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(editor).not.toBeInTheDocument()
  await expect.element(edit).toHaveFocus()
  expect(onClose).not.toHaveBeenCalled()
})

it('keeps the opener summary visible after returning focus to a pointer-activated button', async () => {
  await renderFeature(
    <FeaturePanelDrawer show>
      <DrawerTitle>Features</DrawerTitle>
      <ConversationOpener />
    </FeaturePanelDrawer>,
    { opening: { enabled: true, opening_statement: 'Hi there' } },
  )
  const drawer = page.getByRole('dialog', { name: 'Features' })
  const edit = drawer.getByRole('button', { name: 'Edit opener' })
  await drawer.getByText('Hi there').hover()
  await edit.click()
  const editor = page.getByRole('dialog', { name: 'Conversation Opener' })
  await expect.element(editor).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(editor).not.toBeInTheDocument()
  await drawer.getByRole('heading', { name: 'Features' }).hover()
  await expect.element(edit).toHaveFocus()
  await expect.element(drawer.getByText('Hi there')).toBeVisible()
})
