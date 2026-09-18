import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import AppIconPicker from '../../app-icon-picker'
import { backgroundColors } from '../constants'
import EmojiPickerInner from '../Inner'

// Real layout is needed to verify virtualized rows remain reachable using the keyboard.
it('selects a searched emoji with the keyboard and keeps style controls usable', async () => {
  const onSelect = vi.fn()
  await render(
    <div style={{ width: 380 }}>
      <EmojiPickerInner onSelect={onSelect} />
    </div>,
  )
  const search = page.getByRole('searchbox')
  await search.fill('rabbit face')
  await expect.element(page.getByRole('gridcell', { name: 'Rabbit face' })).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => onSelect.mock.lastCall).toEqual(['🐰', '#FFEAD5'])
  await page.getByRole('button', { name: '#E4FBCC' }).click()
  expect(onSelect).toHaveBeenLastCalledWith('🐰', '#E4FBCC')
  await search.fill('')
  await expect
    .element(page.getByRole('gridcell', { name: 'Grinning face', exact: true }))
    .toBeVisible()
  await search.click()
  await userEvent.keyboard(
    '{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}',
  )
  expect(onSelect).toHaveBeenCalledTimes(3)
})

// The production dialog is narrower than the old fixed-width eight-column grid.
// Verify every edge option is visible and clickable, rather than hiding overflow.
it('fits emoji and style options inside the app icon dialog', async () => {
  const originalFontSize = document.documentElement.style.fontSize
  document.documentElement.style.fontSize = '16px'
  onTestFinished(() => {
    document.documentElement.style.fontSize = originalFontSize
  })
  const onSelect = vi.fn()
  await render(
    <AppIconPicker
      open
      onOpenChange={() => {}}
      onSelect={onSelect}
      initialEmoji={{ icon: 'robot_face' }}
    />,
  )
  const dialog = page.getByRole('dialog')
  const firstEmoji = page.getByRole('gridcell', { name: 'Grinning face', exact: true })
  await expect.element(firstEmoji).toBeVisible()
  const bounds = dialog.element().getBoundingClientRect()
  const options = [
    ...dialog.element().querySelectorAll('[role="row"] [role="gridcell"]'),
    ...backgroundColors.map((color) =>
      page.getByRole('button', { name: color, exact: true }).element(),
    ),
  ]
  for (const option of options) {
    const rect = option.getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(bounds.left)
    expect(rect.right).toBeLessThanOrEqual(bounds.right)
  }
  const footerTop = page
    .getByRole('button', { name: 'app.iconPicker.ok', exact: true })
    .element()
    .getBoundingClientRect().top
  for (const color of backgroundColors) {
    expect(
      page.getByRole('button', { name: color, exact: true }).element().getBoundingClientRect()
        .bottom,
    ).toBeLessThanOrEqual(footerTop)
  }
  await page.getByRole('gridcell', { name: 'Face with tears of joy', exact: true }).click()
  await page.getByRole('button', { name: backgroundColors.at(-1)!, exact: true }).click()
  await page.getByRole('button', { name: 'app.iconPicker.ok', exact: true }).click()
  expect(onSelect).toHaveBeenCalledWith({
    type: 'emoji',
    icon: '😂',
    background: backgroundColors.at(-1),
  })
})
