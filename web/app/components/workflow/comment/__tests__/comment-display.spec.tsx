import type { ReactElement } from 'react'
import { Popover, PopoverPortal, PopoverPositioner } from '@langgenius/dify-ui/popover'
import { render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { CommentMarker } from '../comment-marker'
import {
  CommentMessage,
  CommentReplyBar,
  CommentThreadItem,
  CommentThreadList,
  CommentThreadPopup,
} from '../thread-view'

// Avatars keep one URL per picture in the query cache.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createConsoleQueryWrapper().wrapper })

const ann = { id: 'ann', name: 'Ann', color: '#155AEF' }

it('marks the selected comment pin and shows up to two participants', () => {
  render(
    <CommentMarker
      selected
      data-testid="marker"
      participants={[ann, { id: 'bob', name: 'Bob' }, { id: 'cid', name: 'Cid' }]}
    />,
  )

  expect(screen.getByTestId('marker')).toHaveAttribute('data-selected')
  expect(screen.getByRole('img', { name: 'Ann' })).toBeInTheDocument()
  expect(screen.getByText('+2')).toBeInTheDocument()
})

it('renders a thread dialog with its messages, mentions and close action', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <PopoverPortal>
        <PopoverPositioner anchor={document.body}>
          <CommentThreadPopup title="Comments" closeLabel="Close comment">
            <CommentThreadList>
              <CommentThreadItem>
                <CommentMessage
                  author={ann}
                  timeLabel="2 minutes ago"
                  content="Thanks @Bob for checking"
                  mentionNames={['Bob']}
                />
              </CommentThreadItem>
            </CommentThreadList>
            <CommentReplyBar author={{ id: 'me', name: 'Me' }}>
              <textarea placeholder="Reply" />
            </CommentReplyBar>
          </CommentThreadPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>,
  )

  expect(screen.getByRole('dialog', { name: 'Comments' })).toBeInTheDocument()
  expect(screen.getByText('2 minutes ago')).toBeInTheDocument()
  expect(screen.getByText('@Bob')).toHaveClass('text-text-accent')
  expect(screen.getByPlaceholderText('Reply')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close comment' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
