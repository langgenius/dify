'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useRef } from 'react'

type ParagraphInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

const ParagraphInput: FC<ParagraphInputProps> = ({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const lines = value ? value.split('\n') : ['']
  const lineCount = Math.max(3, lines.length)

  return (
    <div className={cn('rounded-xl bg-components-input-bg-normal px-3 pt-3 pb-2', className)}>
      <div className="relative">
        <div className="pointer-events-none absolute top-0 left-0 flex flex-col">
          {Array.from({ length: lineCount }, (_, index) => (
            <span
              key={index}
              className="flex h-[20px] items-center font-mono text-xs leading-[20px] text-text-quaternary select-none"
            >
              {String(index + 1).padStart(2, '0')}
            </span>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full resize-none border-0 bg-transparent pl-6 font-mono text-xs leading-[20px] text-text-secondary outline-hidden placeholder:text-text-quaternary"
          style={{
            minHeight: `${Math.max(3, lineCount) * 20}px`,
            lineHeight: '20px',
          }}
          rows={Math.max(3, lineCount)}
        />
      </div>
    </div>
  )
}

export default React.memo(ParagraphInput)
