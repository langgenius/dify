import type { CompositionEvent, Ref } from 'react'
import { useMergedRefs } from '@langgenius/dify-ui/use-merged-refs'
import { useRef, useState } from 'react'

type SearchInputOptions = {
  value: string
  onValueChange: (value: string) => void
  ref?: Ref<HTMLInputElement>
}

export function useSearchInput({ value, onValueChange, ref }: SearchInputOptions) {
  const inputRef = useRef<HTMLInputElement>(null)
  const mergedRef = useMergedRefs(inputRef, ref)
  const isComposingRef = useRef(false)
  const compositionCommitRef = useRef<string | null>(null)
  const [compositionValue, setCompositionValue] = useState<string | null>(null)

  const clear = () => {
    isComposingRef.current = false
    compositionCommitRef.current = null
    setCompositionValue(null)
    onValueChange('')
    inputRef.current?.focus()
  }

  return {
    clear,
    inputProps: {
      ref: mergedRef,
      value: compositionValue ?? value,
      onValueChange: (nextValue: string) => {
        if (isComposingRef.current) {
          setCompositionValue(nextValue)
          return
        }
        if (compositionCommitRef.current !== null) {
          const committedValue = compositionCommitRef.current
          compositionCommitRef.current = null
          if (committedValue === nextValue) return
        }
        onValueChange(nextValue)
      },
      onCompositionStart: () => {
        isComposingRef.current = true
        compositionCommitRef.current = null
        setCompositionValue(value)
      },
      onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => {
        if (!isComposingRef.current) return

        isComposingRef.current = false
        setCompositionValue(null)
        compositionCommitRef.current = event.currentTarget.value
        onValueChange(event.currentTarget.value)
      },
    },
  }
}
