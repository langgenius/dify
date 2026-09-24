import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import AppIconPicker from '../../app-icon-picker'
import EmojiPickerInner from '../Inner'

// Real layout verifies keyboard navigation scrolls the shared list to the active row.
it('selects a searched emoji and scrolls to later rows with the keyboard', async () => {
  const onSelect = vi.fn()
  await render(
    <div style={{ width: 322, height: 480, display: 'flex' }}>
      <EmojiPickerInner onSelect={onSelect} />
    </div>,
  )
  const search = page.getByRole('searchbox')
  await search.fill('rabbit face')
  await expect.element(page.getByRole('gridcell', { name: 'Rabbit face' })).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => onSelect.mock.lastCall).toEqual(['🐰', '#FEF3F2'])
  await search.fill('')
  await expect
    .element(page.getByRole('gridcell', { name: 'Grinning face', exact: true }))
    .toBeVisible()
  await search.click()
  await userEvent.keyboard(
    '{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}',
  )
  expect(onSelect).toHaveBeenCalledTimes(2)
})

// Guard against the scrollbar clipping the ninth column or the footer obscuring selectable rows.
it('keeps the rightmost emoji clickable inside the app icon dialog', async () => {
  const onSelect = vi.fn()
  await render(<AppIconPicker open onOpenChange={() => {}} onSelect={onSelect} />)
  const option = page.getByRole('gridcell', { name: 'Slightly smiling face', exact: true })
  await expect.element(option).toBeVisible()
  const dialogBounds = page.getByRole('dialog').element().getBoundingClientRect()
  const optionBounds = option.element().getBoundingClientRect()
  expect(optionBounds.right).toBeLessThanOrEqual(dialogBounds.right)
  await option.click()
  await page.getByRole('button', { name: 'app.iconPicker.ok', exact: true }).click()
  expect(onSelect).toHaveBeenCalledWith({ type: 'emoji', icon: '🙂', background: '#FEF3F2' })
})

// The old layout pinned recommendations while only the category grid scrolled.
it('scrolls recommendations and categories together while keeping search and actions fixed', async () => {
  await render(<AppIconPicker open onOpenChange={() => {}} initialEmoji={{ icon: '🤖' }} />)
  await expect
    .element(page.getByRole('gridcell', { name: 'Grinning face', exact: true }))
    .toBeVisible()
  const scroller = page.getByRole('region', { name: 'app.iconPicker.emoji', exact: true }).element()
  const recommendation = page.getByRole('region', { name: 'app.iconPicker.recommend' }).element()
  const search = page.getByRole('searchbox').element()
  const confirm = page.getByRole('button', { name: 'app.iconPicker.ok', exact: true }).element()
  const styles = page.getByRole('region', { name: 'app.iconPicker.chooseStyle' }).element()
  const stylesTop = styles.getBoundingClientRect().top
  const searchTop = search.getBoundingClientRect().top
  const confirmTop = confirm.getBoundingClientRect().top
  scroller.scrollTo({ top: 400 })
  await expect
    .poll(() => recommendation.getBoundingClientRect().bottom)
    .toBeLessThan(scroller.getBoundingClientRect().top)
  const category = page.getByText('Smileys & emotion', { exact: true }).element()
  expect(category.getBoundingClientRect().top).toBe(scroller.getBoundingClientRect().top)
  expect(styles.getBoundingClientRect().top).toBe(stylesTop)
  await page.getByRole('button', { name: '#F0F2F5', exact: true }).click()
  await expect
    .element(page.getByRole('button', { name: '#F0F2F5', exact: true }))
    .toHaveAttribute('aria-pressed', 'true')
  expect(search.getBoundingClientRect().top).toBe(searchTop)
  expect(confirm.getBoundingClientRect().top).toBe(confirmTop)
})
