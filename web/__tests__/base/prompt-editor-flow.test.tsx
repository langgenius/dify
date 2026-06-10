import type { EventEmitter } from 'ahooks/lib/useEventEmitter'
import type { ComponentProps } from 'react'
import type { EventEmitterValue } from '@/context/event-emitter'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getNearestEditorFromDOMNode } from 'lexical'
import { useEffect } from 'react'
import PromptEditor from '@/app/components/base/prompt-editor'
import {
  UPDATE_DATASETS_EVENT_EMITTER,
  UPDATE_HISTORY_EVENT_EMITTER,
} from '@/app/components/base/prompt-editor/constants'
import { PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER } from '@/app/components/base/prompt-editor/plugins/update-block'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'

type Captures = {
  eventEmitter: EventEmitter<EventEmitterValue> | null
  events: EventEmitterValue[]
}

const EventProbe = ({ captures }: { captures: Captures }) => {
  const { eventEmitter } = useEventEmitterContextContext()

  useEffect(() => {
    captures.eventEmitter = eventEmitter
  }, [captures, eventEmitter])

  eventEmitter?.useSubscription((value) => {
    captures.events.push(value)
  })

  return <button type="button">outside</button>
}

const PromptEditorHarness = ({
  captures,
  ...props
}: ComponentProps<typeof PromptEditor> & { captures: Captures }) => (
  <EventEmitterContextProvider>
    <EventProbe captures={captures} />
    <PromptEditor {...props} />
  </EventEmitterContextProvider>
)

describe('Base Prompt Editor Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Real prompt editor integration should emit block updates and transform editor updates into text output.
  describe('Editor Shell', () => {
    it('should render with the real editor, emit dataset/history events, and convert update events into text changes', async () => {
      const captures: Captures = { eventEmitter: null, events: [] }
      const onChange = vi.fn()
      const onFocus = vi.fn()
      const onBlur = vi.fn()
      const user = userEvent.setup()

      const { rerender, container } = render(
        <PromptEditorHarness
          captures={captures}
          instanceId="editor-1"
          compact={true}
          className="editor-shell"
          placeholder="Type prompt"
          onChange={onChange}
          onFocus={onFocus}
          onBlur={onBlur}
          contextBlock={{
            show: false,
            datasets: [{ id: 'ds-1', name: 'Dataset One', type: 'dataset' }],
          }}
          historyBlock={{
            show: false,
            history: { user: 'user-role', assistant: 'assistant-role' },
          }}
        />,
      )

      expect(screen.getByText('Type prompt')).toBeInTheDocument()

      await waitFor(() => {
        expect(captures.eventEmitter).not.toBeNull()
      })

      const editable = container.querySelector('[contenteditable="true"]') as HTMLElement
      expect(editable).toBeInTheDocument()

      await user.click(editable)
      await waitFor(() => {
        expect(onFocus).toHaveBeenCalledTimes(1)
      })

      await user.click(screen.getByRole('button', { name: 'outside' }))
      await waitFor(() => {
        expect(onBlur).toHaveBeenCalledTimes(1)
      })

      act(() => {
        captures.eventEmitter?.emit({
          type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
          instanceId: 'editor-1',
          payload: 'first line\nsecond line',
        })
      })

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith('first line\nsecond line')
      })

      expect(captures.events).toContainEqual({
        type: UPDATE_DATASETS_EVENT_EMITTER,
        payload: [{ id: 'ds-1', name: 'Dataset One', type: 'dataset' }],
      })
      expect(captures.events).toContainEqual({
        type: UPDATE_HISTORY_EVENT_EMITTER,
        payload: { user: 'user-role', assistant: 'assistant-role' },
      })

      rerender(
        <PromptEditorHarness
          captures={captures}
          instanceId="editor-1"
          contextBlock={{
            show: false,
            datasets: [{ id: 'ds-2', name: 'Dataset Two', type: 'dataset' }],
          }}
          historyBlock={{
            show: false,
            history: { user: 'user-next', assistant: 'assistant-next' },
          }}
        />,
      )

      await waitFor(() => {
        expect(captures.events).toContainEqual({
          type: UPDATE_DATASETS_EVENT_EMITTER,
          payload: [{ id: 'ds-2', name: 'Dataset Two', type: 'dataset' }],
        })
      })
      expect(captures.events).toContainEqual({
        type: UPDATE_HISTORY_EVENT_EMITTER,
        payload: { user: 'user-next', assistant: 'assistant-next' },
      })
    })

    it('should tolerate updates without onChange and rethrow lexical runtime errors through the configured handler', async () => {
      const captures: Captures = { eventEmitter: null, events: [] }
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { container } = render(
        <PromptEditorHarness
          captures={captures}
          instanceId="editor-2"
          editable={false}
          placeholder="Read only prompt"
        />,
      )

      await waitFor(() => {
        expect(captures.eventEmitter).not.toBeNull()
      })

      act(() => {
        captures.eventEmitter?.emit({
          type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
          instanceId: 'editor-2',
          payload: 'silent update',
        })
      })

      const editable = container.querySelector('[contenteditable="false"]') as HTMLElement
      const editor = getNearestEditorFromDOMNode(editable)

      expect(editable).toBeInTheDocument()
      expect(editor).not.toBeNull()
      expect(screen.getByRole('textbox')).toHaveTextContent('silent update')

      expect(() => {
        act(() => {
          editor?.update(() => {
            throw new Error('prompt-editor boom')
          })
        })
      }).toThrow('prompt-editor boom')

      consoleErrorSpy.mockRestore()
    })
  })
})
