import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import type { EventEmitterValue } from '@/context/event-emitter'
import { act, waitFor } from '@testing-library/react'
import { $getRoot } from 'lexical'
import { useEffect } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { CustomTextNode } from '../custom-text/node'
import UpdateBlock, {
  PROMPT_EDITOR_INSERT_QUICKLY,
  PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
} from '../update-block'
import {
  readEditorStateValue,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from './test-helpers'

const setup = async () => {
  let emitter: EventEmitter<EventEmitterValue> | null = null
  const CaptureEmitter = () => {
    const { eventEmitter } = useEventEmitterContextContext()
    useEffect(() => {
      emitter = eventEmitter
    }, [eventEmitter])
    return null
  }
  const view = renderLexicalEditor({
    namespace: 'update-block',
    nodes: [CustomTextNode],
    children: (
      <EventEmitterContextProvider>
        <CaptureEmitter />
        <UpdateBlock instanceId="editor-1" />
      </EventEmitterContextProvider>
    ),
  })
  const editor = await waitForEditorReady(view.getEditor)
  return {
    ...view,
    editor,
    emit: (event: EventEmitterValue) => {
      act(() => {
        emitter!.emit(event)
      })
    },
  }
}

it('applies updates only to the addressed editor and unsubscribes on unmount', async () => {
  const { editor, emit, unmount } = await setup()
  emit({
    type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
    instanceId: 'editor-1',
    payload: 'First line\nSecond line',
  })
  await waitFor(() =>
    expect(
      readEditorStateValue(editor, () =>
        $getRoot()
          .getChildren()
          .map((node) => node.getTextContent())
          .join('\n'),
      ),
    ).toBe('First line\nSecond line'),
  )
  emit({
    type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
    instanceId: 'other-editor',
    payload: 'Wrong editor',
  })
  expect(
    readEditorStateValue(editor, () =>
      $getRoot()
        .getChildren()
        .map((node) => node.getTextContent())
        .join('\n'),
    ),
  ).toBe('First line\nSecond line')
  unmount()
  emit({
    type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
    instanceId: 'editor-1',
    payload: 'Too late',
  })
  expect(
    readEditorStateValue(editor, () =>
      $getRoot()
        .getChildren()
        .map((node) => node.getTextContent())
        .join('\n'),
    ),
  ).toBe('First line\nSecond line')
})

it('inserts the quick-command slash at the selection only for the matching editor', async () => {
  const { editor, emit } = await setup()
  emit({
    type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
    instanceId: 'editor-1',
    payload: 'Prompt ',
  })
  await waitFor(() => expect(readRootTextContent(editor)).toBe('Prompt '))
  selectRootEnd(editor)
  emit({ type: PROMPT_EDITOR_INSERT_QUICKLY, instanceId: 'other-editor' })
  expect(readRootTextContent(editor)).toBe('Prompt ')
  emit({ type: PROMPT_EDITOR_INSERT_QUICKLY, instanceId: 'editor-1' })
  await waitFor(() => expect(readRootTextContent(editor)).toBe('Prompt /'))
})
