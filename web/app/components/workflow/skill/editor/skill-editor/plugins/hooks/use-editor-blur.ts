import type { LexicalEditor } from 'lexical'
import { BLUR_COMMAND, COMMAND_PRIORITY_EDITOR, FOCUS_COMMAND, mergeRegister } from 'lexical'
import { useCallback, useEffect, useRef, useState } from 'react'

export const useEditorBlur = (editor: LexicalEditor) => {
  const [blurHidden, setBlurHidden] = useState(false)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearBlurTimer = useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    const unregister = mergeRegister(
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          clearBlurTimer()
          blurTimerRef.current = setTimeout(() => setBlurHidden(true), 200)
          return false
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          clearBlurTimer()
          setBlurHidden(false)
          return false
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )

    return () => {
      if (blurTimerRef.current)
        clearTimeout(blurTimerRef.current)
      unregister()
    }
  }, [editor, clearBlurTimer])

  return {
    blurHidden,
  }
}
