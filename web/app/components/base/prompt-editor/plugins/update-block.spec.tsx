import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import { $getRoot, COMMAND_PRIORITY_EDITOR } from 'lexical'
import { CustomTextNode } from './custom-text/node'
import { CaptureEditorPlugin } from './test-utils'
import UpdateBlock, {
  PROMPT_EDITOR_INSERT_QUICKLY,
  PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
} from './update-block'
import { CLEAR_HIDE_MENU_TIMEOUT } from './workflow-variable-block'

const { mockUseEventEmitterContextContext } = vi.hoisted(() => ({
  mockUseEventEmitterContextContext: vi.fn(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => mockUseEventEmitterContextContext(),
}))

type TestEvent = {
  type: string
  instanceId?: string
  payload?: string
}

const readEditorText = (editor: LexicalEditor) => {
  let content = ''

  editor.getEditorState().read(() => {
    content = $getRoot().getTextContent()
  })

  return content
}

const selectRootEnd = (editor: LexicalEditor) => {
  act(() => {
    editor.update(() => {
      $getRoot().selectEnd()
    })
  })
}

const setup = (props?: {
  instanceId?: string
  withEventEmitter?: boolean
}) => {
  const callbacks: Array<(event: TestEvent) => void> = []

  const eventEmitter = props?.withEventEmitter === false
    ? null
    : {
        useSubscription: vi.fn((callback: (event: TestEvent) => void) => {
          callbacks.push(callback)
        }),
      }

  mockUseEventEmitterContextContext.mockReturnValue({ eventEmitter })

  let editor: LexicalEditor | null = null
  const onReady = (value: LexicalEditor) => {
    editor = value
  }

  render(
    <LexicalComposer
      initialConfig={{
        namespace: 'update-block-plugin-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [CustomTextNode],
      }}
    >
      <UpdateBlock instanceId={props?.instanceId} />
      <CaptureEditorPlugin onReady={onReady} />
    </LexicalComposer>,
  )

  const emit = (event: TestEvent) => {
    act(() => {
      callbacks.forEach(callback => callback(event))
    })
  }

  return {
    callbacks,
    emit,
    eventEmitter,
    getEditor: () => editor,
  }
}

describe('UpdateBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Subscription setup', () => {
    it('should register two subscriptions when event emitter is available', () => {
      const { callbacks, eventEmitter } = setup({ instanceId: 'instance-1' })

      expect(eventEmitter).not.toBeNull()
      expect(eventEmitter?.useSubscription).toHaveBeenCalledTimes(2)
      expect(callbacks).toHaveLength(2)
    })

    it('should render without subscriptions when event emitter is null', () => {
      const { callbacks, eventEmitter } = setup({ withEventEmitter: false })

      expect(eventEmitter).toBeNull()
      expect(callbacks).toHaveLength(0)
    })
  })

  describe('Update value event', () => {
    it('should update editor state when update event matches instance id', async () => {
      const { emit, getEditor } = setup({ instanceId: 'instance-1' })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })
      const editor = getEditor()
      expect(editor).not.toBeNull()

      emit({
        type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
        instanceId: 'instance-1',
        payload: 'updated text',
      })

      await waitFor(() => {
        expect(readEditorText(editor!)).toBe('updated text')
      })
    })

    it('should ignore update event when instance id does not match', async () => {
      const { emit, getEditor } = setup({ instanceId: 'instance-1' })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })
      const editor = getEditor()
      expect(editor).not.toBeNull()

      emit({
        type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
        instanceId: 'instance-2',
        payload: 'should not apply',
      })

      await waitFor(() => {
        expect(readEditorText(editor!)).toBe('')
      })
    })
  })

  describe('Quick insert event', () => {
    it('should insert slash and dispatch clear command when quick insert event matches instance id', async () => {
      const { emit, getEditor } = setup({ instanceId: 'instance-1' })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })
      const editor = getEditor()
      expect(editor).not.toBeNull()

      selectRootEnd(editor!)

      const clearCommandHandler = vi.fn(() => true)
      const unregister = editor!.registerCommand(
        CLEAR_HIDE_MENU_TIMEOUT,
        clearCommandHandler,
        COMMAND_PRIORITY_EDITOR,
      )

      emit({
        type: PROMPT_EDITOR_INSERT_QUICKLY,
        instanceId: 'instance-1',
      })

      await waitFor(() => {
        expect(readEditorText(editor!)).toBe('/')
      })
      expect(clearCommandHandler).toHaveBeenCalledTimes(1)

      unregister()
    })

    it('should ignore quick insert event when instance id does not match', async () => {
      const { emit, getEditor } = setup({ instanceId: 'instance-1' })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })
      const editor = getEditor()
      expect(editor).not.toBeNull()

      selectRootEnd(editor!)

      emit({
        type: PROMPT_EDITOR_INSERT_QUICKLY,
        instanceId: 'instance-2',
      })

      await waitFor(() => {
        expect(readEditorText(editor!)).toBe('')
      })
    })
  })
})
