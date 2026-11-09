import type { CompositionEvent, KeyboardEvent, MouseEvent, Ref } from 'react'
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
  const displayValue = compositionValue ?? value

  const clear = () => {
    isComposingRef.current = false
    compositionCommitRef.current = null
    setCompositionValue(null)
    onValueChange('')
    inputRef.current?.focus()
  }

  return {
    clear,
    canClear: displayValue !== '',
    // The input is the only tab stop; the clear button is a pointer shortcut that never takes
    // focus, matching Base UI's `Combobox.Clear`. Keyboard users clear with Escape.
    clearProps: {
      tabIndex: -1,
      onMouseDown: (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
      },
      onClick: clear,
    },
    inputProps: {
      ref: mergedRef,
      // A plain text input with the searchbox role: browsers attach private Escape and
      // cancel-button behavior to `type="search"`, and this hook owns both instead.
      type: 'text' as const,
      role: 'searchbox',
      value: displayValue,
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
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Escape') return
        // Escape ends the composition first; the IME owns that press.
        if (isComposingRef.current || event.nativeEvent.isComposing) return
        // An empty searchbox lets Escape reach the owning popover or dialog.
        if (displayValue === '') return
        event.preventDefault()
        event.stopPropagation()
        clear()
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
