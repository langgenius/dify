import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockEmojiData } from '@/test/emoji-picker'
import EmojiPickerInner from '../Inner'

vi.mock('@/utils/var', () => ({ basePath: '/console' }))
mockEmojiData()

it('selects Unicode from self-hosted data while preserving the existing background', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<EmojiPickerInner background="#E4FBCC" onSelect={onSelect} />)
  await user.click(await screen.findByRole('gridcell', { name: 'Grinning face' }))
  expect(onSelect).toHaveBeenCalledWith('😀', '#E4FBCC')
  expect(fetch).toHaveBeenCalledWith(
    '/console/emoji/emojibase-17.0.0/en/data.json',
    expect.any(Object),
  )
})

it('filters search, selects a result, shows empty state and restores recommendations on clear', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<EmojiPickerInner onSelect={onSelect} />)
  const search = screen.getByRole('searchbox')
  await user.type(search, 'rabbit')
  await user.click(await screen.findByRole('gridcell', { name: 'Rabbit face' }))
  expect(onSelect).toHaveBeenLastCalledWith('🐰', '#FEF3F2')
  expect(screen.queryByRole('region', { name: 'app.iconPicker.recommend' })).not.toBeInTheDocument()
  await user.clear(search)
  await user.type(search, 'zzzz-no-emoji')
  await screen.findByText('common.noData')
  await user.clear(search)
  expect(screen.getByRole('region', { name: 'app.iconPicker.recommend' })).toBeInTheDocument()
  await screen.findByRole('gridcell', { name: 'Grinning face' })
})
