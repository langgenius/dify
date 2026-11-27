import type { ReactElement } from 'react'
import type { Collaborator } from '../collaborator-avatar'
import { render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { NodeEditorAvatars, NodePanelEditingFrame } from '../node-editors'

// Avatars keep one URL per picture in the query cache.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createConsoleQueryWrapper().wrapper })

const editor = (id: string, name: string, color: string): Collaborator => ({
  id,
  name,
  avatarUrl: null,
  color,
})

const ann = editor('ann', 'Ann', '#155AEF')
const bob = editor('bob', 'Bob', '#C11574')
const cid = editor('cid', 'Cid', '#3B7C0F')
const dee = editor('dee', 'Dee', '#B54708')

it('names each editor and shows who is editing on hover', async () => {
  const user = userEvent.setup()
  render(<NodeEditorAvatars editors={[ann, bob]} />)

  const annAvatar = screen.getByRole('img', {
    name: 'workflow.collaboration.userEditing:{"name":"Ann"}',
  })
  expect(screen.getByText('A')).toHaveStyle({ backgroundColor: '#155AEF' })
  await user.hover(annAvatar)
  expect(await screen.findByText('workflow.collaboration.userEditing:{"name":"Ann"}')).toBeVisible()
})

it('opens the editing tooltip when an avatar receives keyboard focus', async () => {
  const user = userEvent.setup()
  render(<NodeEditorAvatars editors={[bob]} />)

  await user.tab()
  expect(
    screen.getByRole('img', { name: 'workflow.collaboration.userEditing:{"name":"Bob"}' }),
  ).toHaveFocus()
  expect(await screen.findByText('workflow.collaboration.userEditing:{"name":"Bob"}')).toBeVisible()
})

it('folds editors beyond the visible limit into a named count', () => {
  render(<NodeEditorAvatars editors={[ann, bob, cid, dee]} />)

  expect(screen.getAllByRole('img')).toHaveLength(3)
  expect(
    screen.getByRole('img', {
      name: 'workflow.collaboration.userEditing:{"name":"Cid"}, workflow.collaboration.userEditing:{"name":"Dee"}',
    }),
  ).toHaveTextContent('+2')
})

it('frames the panel in the editor’s color with an editing tag', () => {
  const { rerender } = render(<NodePanelEditingFrame editor={bob} />)

  expect(screen.getByTestId('node-panel-editing-frame')).toHaveStyle('--editor-color: #C11574')
  expect(screen.getByText('workflow.collaboration.userEditing:{"name":"Bob"}')).toBeVisible()

  rerender(<NodePanelEditingFrame editor={undefined} />)
  expect(screen.queryByTestId('node-panel-editing-frame')).not.toBeInTheDocument()
})
