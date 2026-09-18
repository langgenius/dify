import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockEmojiData } from '@/test/emoji-picker'
import EmojiPickerInner from '../Inner'

vi.mock('@/utils/var', () => ({ basePath: '/console' }))

mockEmojiData()

describe('EmojiPickerInner', () => {
  it('selects Unicode from self-hosted data and preserves the chosen background', async () => {
    const onSelect = vi.fn()
    render(<EmojiPickerInner onSelect={onSelect} />)
    fireEvent.click(await screen.findByRole('gridcell', { name: 'Grinning face' }))
    expect(onSelect).toHaveBeenLastCalledWith('😀', '#FFEAD5')
    fireEvent.click(screen.getByRole('button', { name: '#E4FBCC' }))
    expect(onSelect).toHaveBeenLastCalledWith('😀', '#E4FBCC')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledWith(
      '/console/emoji/emojibase-17.0.0/en/data.json',
      expect.any(Object),
    )
    expect(fetch).toHaveBeenCalledWith(
      '/console/emoji/emojibase-17.0.0/en/messages.json',
      expect.any(Object),
    )
  })

  it('filters search, selects a result, shows empty state and restores categories on clear', async () => {
    const onSelect = vi.fn()
    render(<EmojiPickerInner onSelect={onSelect} />)
    await screen.findByRole('gridcell', { name: 'Grinning face' })
    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'rabbit' } })
    fireEvent.click(await screen.findByRole('gridcell', { name: 'Rabbit face' }))
    expect(onSelect).toHaveBeenLastCalledWith('🐰', '#FFEAD5')
    fireEvent.change(search, { target: { value: 'zzzz-no-emoji' } })
    await screen.findByText('common.noData')
    fireEvent.change(search, { target: { value: '' } })
    await screen.findByRole('gridcell', { name: 'Grinning face' })
  })

  it('resolves a saved ID in style previews and only emits after a user action', async () => {
    const onSelect = vi.fn()
    render(<EmojiPickerInner emoji="rabbit" onSelect={onSelect} />)
    const color = screen.getByRole('button', { name: '#E4FBCC' })
    expect(color).toHaveTextContent('🐰')
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(color)
    expect(onSelect).toHaveBeenCalledWith('🐰', '#E4FBCC')
    fireEvent.click(screen.getByRole('button', { name: 'Choose Style' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '#E4FBCC' })).not.toBeInTheDocument(),
    )
  })
})
