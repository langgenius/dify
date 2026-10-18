import type { ChatItem } from '../../../types'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createChatAnnotationFixture } from '@/test/fixtures/chat'
import BasicContent from '../basic-content'

const item: ChatItem = { id: 'answer', content: 'Original answer', isAnswer: true }

it.each(['Edited answer', ''])(
  'replaces the answer with its saved annotation %j',
  async (content) => {
    const { rerender } = render(<BasicContent item={item} />)
    expect(await screen.findByText('Original answer')).toBeInTheDocument()
    rerender(<BasicContent item={{ ...item, annotation: createChatAnnotationFixture(content) }} />)
    expect(screen.queryByText('Original answer')).not.toBeInTheDocument()
    if (content) expect(await screen.findByText(content)).toBeInTheDocument()
  },
)

it.each(['\\\\server\\share\\file.txt', '`\\\\server\\share\\file.txt`'])(
  'preserves the visible Windows path from %j',
  async (content) => {
    render(<BasicContent item={{ ...item, content }} />)
    expect(await screen.findByText('\\\\server\\share\\file.txt')).toBeInTheDocument()
  },
)

it('preserves a backslash string that is not a UNC path', async () => {
  render(<BasicContent item={{ ...item, content: '\\not-a-unc' }} />)
  expect(await screen.findByText('\\not-a-unc')).toBeInTheDocument()
})
