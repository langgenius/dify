import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommentComposerPreview } from '../comment-composer'
import { CommentMarker } from '../comment-marker'
import {
  CommentMessage,
  CommentReplyBar,
  CommentThreadItem,
  CommentThreadPanel,
} from '../thread-view'

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
    <CommentThreadPanel
      title="Comments"
      closeLabel="Close comment"
      onClose={onClose}
      footer={
        <CommentReplyBar author={{ id: 'me', name: 'Me' }}>
          <CommentComposerPreview value="" placeholder="Reply" />
        </CommentReplyBar>
      }
    >
      <CommentThreadItem>
        <CommentMessage
          author={ann}
          timeLabel="2 minutes ago"
          content="Thanks @Bob for checking"
          mentionNames={['Bob']}
        />
      </CommentThreadItem>
    </CommentThreadPanel>,
  )

  expect(screen.getByRole('dialog', { name: 'Comments' })).toBeInTheDocument()
  expect(screen.getByText('2 minutes ago')).toBeInTheDocument()
  expect(screen.getByText('@Bob')).toHaveClass('text-text-accent')
  expect(screen.getByText('Reply')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close comment' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('enables the preview send button only for non-empty text', () => {
  const { rerender } = render(<CommentComposerPreview value="   " placeholder="Reply" />)
  expect(screen.getByRole('button', { name: 'common.operation.send' })).toBeDisabled()

  rerender(<CommentComposerPreview value="Looks good" placeholder="Reply" />)
  expect(screen.getByRole('button', { name: 'common.operation.send' })).toBeEnabled()
  expect(screen.getByText('Looks good')).toBeInTheDocument()
})
