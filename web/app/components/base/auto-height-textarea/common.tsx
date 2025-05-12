import { useEffect, useRef } from 'react'
import cn from '@/utils/classnames'

type AutoHeightTextareaProps =
  & React.DetailedHTMLProps<React.TextareaHTMLAttributes<HTMLTextAreaElement>, HTMLTextAreaElement>
  & { outerClassName?: string }

const AutoHeightTextarea = (
  {
    ref: outRef,
    outerClassName,
    value,
    className,
    placeholder,
    autoFocus,
    disabled,
    ...rest
  }: AutoHeightTextareaProps & {
    ref: React.RefObject<HTMLTextAreaElement>;
  },
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
    (<div className={outerClassName}>
      <div className='relative'>
        <div className={cn(className, 'invisible whitespace-pre-wrap break-all')}>
          {!value ? placeholder : `${value}`.replace(/\n$/, '\n ')}
        </div>
        <textarea
          ref={ref}
          placeholder={placeholder}
          className={cn(className, 'absolute inset-0 h-full w-full resize-none appearance-none border-none outline-none disabled:bg-transparent')}
          value={value}
          disabled={disabled}
          {...rest}
        />
      </div>
    </div>)
  )
}

AutoHeightTextarea.displayName = 'AutoHeightTextarea'

export default AutoHeightTextarea
