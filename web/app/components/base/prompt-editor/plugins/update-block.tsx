import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { textToEditorState } from '../utils'
import { useEventEmitterContextContext } from '@/context/event-emitter'

export const PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER = 'PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER'

const UpdateBlock = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  const [editor] = useLexicalComposerContext()

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER) {
      const editorState = editor.parseEditorState(textToEditorState(v.payload))
      editor.setEditorState(editorState)
    }
  })

  return null
}

export default UpdateBlock
