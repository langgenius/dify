'use client'

import type { FC } from 'react'
import { useCallback } from 'react'
import { normaliseUserCodeInput } from '../utils/user-code'

type Props = {
  value: string
  onChange: (normalised: string) => void
  disabled?: boolean
  autoFocus?: boolean
}

/**
 * CodeInput renders the user_code text field with live normalisation
 * (uppercase, reduced alphabet, XXXX-XXXX hyphenation).
 *
 * The onChange callback receives the normalised value only — the parent does
 * not need to run validation itself.
 */
const CodeInput: FC<Props> = ({ value, onChange, disabled, autoFocus }) => {
  const handle = useCallback((raw: string) => {
    onChange(normaliseUserCodeInput(raw))
  }, [onChange])

  return (
    <input
      type="text"
      inputMode="text"
      autoCapitalize="characters"
      autoComplete="off"
      spellCheck={false}
      placeholder="ABCD-1234"
      maxLength={9}
      aria-label="one-time code"
      className="w-full rounded-lg border border-components-input-border-normal bg-components-input-bg-normal px-4 py-3 text-center text-2xl font-mono tracking-wider text-text-primary focus:border-components-input-border-active focus:outline-none"
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={e => handle(e.target.value)}
    />
  )
}

export default CodeInput
