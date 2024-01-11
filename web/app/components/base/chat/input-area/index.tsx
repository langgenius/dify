import type { FC } from 'react'
import { useChatContext } from '../context'
import type { OnSend } from '../types'
import Input from './input'

type InputAreaProps = {
  onSend?: OnSend
}
const InputArea: FC<InputAreaProps> = ({
  onSend,
}) => {
  const { config } = useChatContext()

  return (
    <div>
      <Input
        visionConfig={config.file_upload.image}
        speechToTextConfig={config.speech_to_text}
        onSend={onSend}
      />
    </div>
  )
}

export default InputArea
