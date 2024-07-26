import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { TextAreaRef } from 'rc-textarea'

export const useTextAreaHeight = () => {
  const textareaRef = useRef<TextAreaRef>(null)
  const [height, setHeight] = useState(0)

  const handleComputeHeight = () => {
    const textareaElement = textareaRef.current?.resizableTextArea.textArea
    if (textareaElement) {
      const { height } = textareaElement.getBoundingClientRect()

      setHeight(height)
    }
  }

  useEffect(() => {
    handleComputeHeight()
  }, [])

  const handleTextareaResize = useCallback(() => {
    handleComputeHeight()
  }, [])

  return {
    textareaRef,
    handleTextareaResize,
    isMultipleLine: useMemo(() => height > 32, [height]),
  }
}
