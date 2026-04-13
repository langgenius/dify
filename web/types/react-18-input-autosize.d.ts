declare module 'react-18-input-autosize' {
  import type { ChangeEvent, CSSProperties, FocusEvent, KeyboardEvent } from 'react'

  export type AutosizeInputProps = {
    value?: string | number
    defaultValue?: string | number
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
    onFocus?: (event: FocusEvent<HTMLInputElement>) => void
    onBlur?: (event: FocusEvent<HTMLInputElement>) => void
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
    placeholder?: string
    className?: string
    inputClassName?: string
    style?: CSSProperties
    inputStyle?: CSSProperties
    minWidth?: number | string
    maxWidth?: number | string
    [key: string]: any
  }

  const AutosizeInput: React.FC<AutosizeInputProps>
  export default AutosizeInput
}
