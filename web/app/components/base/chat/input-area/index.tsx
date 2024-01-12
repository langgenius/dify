import type { FC } from 'react'
import { useChatContext } from '../context'
import type { OnSend } from '../types'
import ChatInput from './chat-input'

type InputAreaProps = {
  onSend?: OnSend
  noChatInput?: boolean
}
const InputArea: FC<InputAreaProps> = ({
  onSend,
  noChatInput,
}) => {
  const { config } = useChatContext()

  return (
    <div>
      {
        !noChatInput && (
          <ChatInput
            visionConfig={config?.file_upload?.image}
            speechToTextConfig={config.speech_to_text}
            onSend={onSend}
          />
        )
      }
    </div>
  )
}

export default InputArea
