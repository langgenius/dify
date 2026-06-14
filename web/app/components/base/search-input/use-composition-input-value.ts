import * as React from 'react'

export type UseCompositionInputValueOptions = {
  value: string
  onValueChange: (value: string) => void
}

export type UseCompositionInputValueReturn = {
  value: string
  onValueChange: (nextValue: string) => void
  onCompositionStart: () => void
  onCompositionEnd: (nextValue: string) => boolean
  resetComposition: () => void
}

export function useCompositionInputValue({
  value,
  onValueChange,
}: UseCompositionInputValueOptions): UseCompositionInputValueReturn {
  const isComposingRef = React.useRef(false)
  const compositionCommitRef = React.useRef<string | null>(null)
  const compositionStartValueRef = React.useRef(value)
  const [compositionValue, setCompositionValue] = React.useState('')

  if (isComposingRef.current && value !== compositionStartValueRef.current) {
    isComposingRef.current = false
    compositionCommitRef.current = null
  }

  const inputValue = isComposingRef.current ? compositionValue : value

  return {
    value: inputValue,
    onValueChange: (nextValue) => {
      if (isComposingRef.current) {
        setCompositionValue(nextValue)
        return
      }

      if (compositionCommitRef.current !== null) {
        if (compositionCommitRef.current !== nextValue) {
          compositionCommitRef.current = null
          onValueChange(nextValue)
          return
        }

        compositionCommitRef.current = null
        return
      }

      onValueChange(nextValue)
    },
    onCompositionStart: () => {
      isComposingRef.current = true
      compositionCommitRef.current = null
      compositionStartValueRef.current = value
      setCompositionValue(value)
    },
    onCompositionEnd: (nextValue) => {
      if (!isComposingRef.current)
        return false

      isComposingRef.current = false
      setCompositionValue('')
      compositionCommitRef.current = nextValue
      onValueChange(nextValue)
      return true
    },
    resetComposition: () => {
      isComposingRef.current = false
      compositionCommitRef.current = null
      setCompositionValue('')
    },
  }
}
