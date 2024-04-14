import { forwardRef, useEffect, useRef } from 'react'
import cn from 'classnames'
import { sleep } from '@/utils'

type IProps = {
  placeholder?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  className?: string
  wrapperClassName?: string
  minHeight?: number
  maxHeight?: number
  autoFocus?: boolean
  controlFocus?: number
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onKeyUp?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

const AutoHeightTextarea = forwardRef(
  (
    { value, onChange, placeholder, className, wrapperClassName, minHeight = 36, maxHeight = 96, autoFocus, controlFocus, onKeyDown, onKeyUp }: IProps,
    outerRef: any,
  ) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const ref = outerRef || useRef<HTMLTextAreaElement>(null)

    const doFocus = () => {
      if (ref.current) {
        ref.current.setSelectionRange(value.length, value.length)
        ref.current.focus()
        return true
      }
      return false
    }

    const focus = async () => {
      if (!doFocus()) {
        let hasFocus = false
        await sleep(100)
        hasFocus = doFocus()
        if (!hasFocus)
          focus()
      }
    }

    useEffect(() => {
      if (autoFocus)
        focus()
    }, [])
    useEffect(() => {
      if (controlFocus)
        focus()
    }, [controlFocus])

    return (
      <div className={`relative ${wrapperClassName}`}>
        <div className={cn(className, 'invisible whitespace-pre-wrap break-all  overflow-y-auto')} style={{
          minHeight,
          maxHeight,
          paddingRight: (value && value.trim().length > 10000) ? 140 : 130,
        }}>
          {!value ? placeholder : value.replace(/\n$/, '\n ')}
        </div>
        <textarea
          ref={ref}
          autoFocus={autoFocus}
          className={cn(className, 'absolute inset-0 resize-none overflow-auto')}
          style={{
            paddingRight: (value && value.trim().length > 10000) ? 140 : 130,
          }}
          placeholder={placeholder}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          value={value}
        />
      </div>
    )
  },
)

AutoHeightTextarea.displayName = 'AutoHeightTextarea'

export default AutoHeightTextarea
