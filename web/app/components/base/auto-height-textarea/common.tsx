import { forwardRef, useEffect, useRef } from 'react'
import cn from 'classnames'

type AutoHeightTextareaProps =
  & React.DetailedHTMLProps<React.TextareaHTMLAttributes<HTMLTextAreaElement>, HTMLTextAreaElement>
  & { outerClassName?: string }

const AutoHeightTextarea = forwardRef<HTMLTextAreaElement, AutoHeightTextareaProps>(
  (
    {
      outerClassName,
      value,
      className,
      placeholder,
      autoFocus,
      disabled,
      ...rest
    },
    outRef,
  ) => {
    const innerRef = useRef<HTMLTextAreaElement>(null)
    const ref = outRef || innerRef

    useEffect(() => {
      if (autoFocus && !disabled && value) {
        if (typeof ref !== 'function') {
          ref.current?.setSelectionRange(`${value}`.length, `${value}`.length)
          ref.current?.focus()
        }
      }
    }, [autoFocus, disabled, ref])
    return (
      <div className={outerClassName}>
        <div className='relative'>
          <div className={cn(className, 'invisible whitespace-pre-wrap break-all')}>
            {!value ? placeholder : `${value}`.replace(/\n$/, '\n ')}
          </div>
          <textarea
            ref={ref}
            placeholder={placeholder}
            className={cn(className, 'disabled:bg-transparent absolute inset-0 outline-none border-none appearance-none resize-none w-full h-full')}
            value={value}
            disabled={disabled}
            {...rest}
          />
        </div>
      </div>
    )
  },
)

export default AutoHeightTextarea
