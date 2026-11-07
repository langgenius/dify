import type { ISavedItemsProps } from '../index'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import SavedItems from '../index'

const mockCopy = vi.fn()

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copy: mockCopy,
    copied: false,
  }),
}))
vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/',
}))

const baseProps: ISavedItemsProps = {
  list: [{ id: '1', answer: 'hello world' }],
  isShowTextToSpeech: true,
  onRemove: vi.fn(),
  onStartCreateContent: vi.fn(),
}

describe('SavedItems', () => {
  it('starts creating content from an empty saved list', async () => {
    const user = userEvent.setup()
    const onStartCreateContent = vi.fn()
    render(<SavedItems {...baseProps} list={[]} onStartCreateContent={onStartCreateContent} />)
    await user.click(
      screen.getByRole('button', { name: 'share.generation.savedNoData.startCreateContent' }),
    )
    expect(onStartCreateContent).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies content and triggers remove callback', async () => {
    const user = userEvent.setup()
    const handleRemove = vi.fn()
    render(<SavedItems {...baseProps} onRemove={handleRemove} />)

    const copyButton = screen.getByRole('button', { name: 'common.operation.copy' })
    const deleteButton = screen.getByRole('button', { name: 'common.operation.delete' })

    await user.click(copyButton)
    expect(mockCopy).toHaveBeenCalledWith('hello world')

    await user.click(deleteButton)
    expect(handleRemove).toHaveBeenCalledWith('1')
  })
})
