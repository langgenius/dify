import type { DraggableBlockPlugin_EXPERIMENTAL } from '@lexical/react/LexicalDraggableBlockPlugin'
import type { ComponentProps } from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import DraggableBlockPlugin from '..'
import { renderLexicalEditor, waitForEditorReady } from '../../__tests__/test-helpers'

type DragProps = ComponentProps<typeof DraggableBlockPlugin_EXPERIMENTAL>
const state = vi.hoisted(() => ({ props: null as DragProps | null }))
vi.mock('@lexical/react/LexicalDraggableBlockPlugin', () => ({
  DraggableBlockPlugin_EXPERIMENTAL: (props: DragProps) => {
    state.props = props
    return (
      <>
        {props.menuComponent}
        {props.targetLineComponent}
      </>
    )
  },
}))

const setup = async () => {
  const view = renderLexicalEditor({ namespace: 'drag-test', children: <DraggableBlockPlugin /> })
  const editor = await waitForEditorReady(view.getEditor)
  const root = document.createElement('div')
  view.container.append(root)
  act(() => editor.setRootElement(root))
  return { ...view, editor, root }
}

it.each(['self', 'ancestor', 'descendant'] as const)(
  'shows drag controls for a supported %s and hides them for plain content',
  async (kind) => {
    const { root } = await setup()
    const parent = document.createElement('div')
    const child = document.createElement('span')
    parent.append(child)
    root.append(parent)
    if (kind === 'descendant') child.className = 'support-drag'
    else parent.className = 'support-drag'
    fireEvent.mouseMove(kind === 'ancestor' ? child : parent)
    expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
    expect(state.props?.isOnMenu(screen.getByTestId('draggable-menu-icon'))).toBe(true)
    expect(state.props?.isOnMenu(parent)).toBe(false)
    fireEvent.mouseMove(root)
    // A separate plain block has neither supported ancestors nor descendants.
    const plain = document.createElement('div')
    root.append(plain)
    fireEvent.mouseMove(plain)
    expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
  },
)

it('follows root replacement and detaches listeners when the plugin unmounts', async () => {
  const { root, editor, container, unmount } = await setup()
  const oldBlock = document.createElement('div')
  oldBlock.className = 'support-drag'
  root.append(oldBlock)
  fireEvent.mouseMove(oldBlock)
  expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
  const nextRoot = document.createElement('div')
  container.append(nextRoot)
  act(() => editor.setRootElement(nextRoot))
  expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
  fireEvent.mouseMove(oldBlock)
  expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
  const nextBlock = document.createElement('div')
  nextBlock.className = 'support-drag'
  nextRoot.append(nextBlock)
  fireEvent.mouseMove(nextBlock)
  expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
  const removeListener = vi.spyOn(nextRoot, 'removeEventListener')
  unmount()
  expect(removeListener).toHaveBeenCalledWith('mousemove', expect.any(Function))
})
