import { $insertNodes } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { textToEditorState } from '../utils'
import { CustomTextNode } from './custom-text/node'
import { CLEAR_HIDE_MENU_TIMEOUT } from './workflow-variable-block'
import { useEventEmitterContextContext } from '@/context/event-emitter'

export const PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER = 'PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER'
export const PROMPT_EDITOR_INSERT_QUICKLY = 'PROMPT_EDITOR_INSERT_QUICKLY'

type UpdateBlockProps = {
  instanceId?: string
}
const UpdateBlock = ({
  instanceId,
}: UpdateBlockProps) => {
  const { eventEmitter } = useEventEmitterContextContext()
  const [editor] = useLexicalComposerContext()

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER && v.instanceId === instanceId) {
      const editorState = editor.parseEditorState(textToEditorState(v.payload))
      editor.setEditorState(editorState)
    }
  })

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === PROMPT_EDITOR_INSERT_QUICKLY && v.instanceId === instanceId) {
      editor.focus()
      editor.update(() => {
        const textNode = new CustomTextNode('/')
        $insertNodes([textNode])

        editor.dispatchCommand(CLEAR_HIDE_MENU_TIMEOUT, undefined)
      })
    }
  })

  return null
}

export default UpdateBlock
