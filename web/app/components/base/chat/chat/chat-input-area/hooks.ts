import {
  useCallback,
  useRef,
  useState,
} from 'react'
import type { TextAreaRef } from 'rc-textarea'

export const useTextAreaHeight = () => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<TextAreaRef>(null)
  const textValueRef = useRef<HTMLDivElement>(null)
  const holdSpaceRef = useRef<HTMLDivElement>(null)
  const [isMultipleLine, setIsMultipleLine] = useState(false)

  const handleComputeHeight = useCallback(() => {
    const textareaElement = textareaRef.current?.resizableTextArea.textArea
    if (wrapperRef.current && textareaElement && textValueRef.current && holdSpaceRef.current) {
      const { width: wrapperWidth } = wrapperRef.current.getBoundingClientRect()
      const { height: textareaHeight } = textareaElement.getBoundingClientRect()
      const { width: textValueWidth } = textValueRef.current.getBoundingClientRect()
      const { width: holdSpaceWidth } = holdSpaceRef.current.getBoundingClientRect()

      if (textareaHeight > 32) {
        setIsMultipleLine(true)
      }
      else {
        if (textValueWidth + holdSpaceWidth >= wrapperWidth)
          setIsMultipleLine(true)
        else
          setIsMultipleLine(false)
      }
    }
  }, [])

  const handleTextareaResize = useCallback(() => {
    handleComputeHeight()
  }, [handleComputeHeight])

  return {
    wrapperRef,
    textareaRef,
    textValueRef,
    holdSpaceRef,
    handleTextareaResize,
    isMultipleLine,
  }
}
