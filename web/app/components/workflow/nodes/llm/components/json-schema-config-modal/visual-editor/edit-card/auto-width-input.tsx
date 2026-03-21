import type { FC } from 'react'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { cn } from '@/utils/classnames'

type AutoWidthInputProps = {
  value: string
  placeholder: string
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onBlur: () => void
  minWidth?: number
  maxWidth?: number
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>

const AutoWidthInput: FC<AutoWidthInputProps> = ({
  value,
  placeholder,
  onChange,
  onBlur,
  minWidth = 60,
  maxWidth = 300,
  className,
  ...props
}) => {
  const [width, setWidth] = useState(minWidth)
  const textRef = React.useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (textRef.current) {
      textRef.current.textContent = value || placeholder
      const textWidth = textRef.current.offsetWidth
      const newWidth = Math.max(minWidth, Math.min(textWidth + 16, maxWidth))
      if (width !== newWidth)
        setWidth(newWidth)
    }
  }, [value, placeholder, minWidth, maxWidth, width])

  // Handle Enter key
  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.currentTarget.blur)
      e.currentTarget.blur()
    if (props.onKeyUp)
      props.onKeyUp(e)
  }

  return (
    <div className="relative inline-flex items-center">
      {/* Hidden measurement span */}
      <span
        ref={textRef}
        className="system-sm-semibold invisible absolute left-0 top-0 -z-10 whitespace-pre px-1"
        aria-hidden="true"
      >
        {value || placeholder}
      </span>

      {/* Actual input element */}
      <input
        value={value}
        className={cn(
          'system-sm-semibold placeholder:system-sm-semibold h-5 rounded-[5px] border border-transparent px-1',
          'py-px text-text-primary caret-[#295EFF] shadow-shadow-shadow-3 outline-none',
          'placeholder:text-text-placeholder hover:bg-state-base-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs',
          className,
        )}
        style={{
          width: `${width}px`,
          minWidth: `${minWidth}px`,
          maxWidth: `${maxWidth}px`,
          transition: 'width 100ms ease-out',
        }}
        placeholder={placeholder}
        onChange={onChange}
        onBlur={onBlur}
        onKeyUp={handleKeyUp}
        {...props}
      />
    </div>
  )
}

export default React.memo(AutoWidthInput)
