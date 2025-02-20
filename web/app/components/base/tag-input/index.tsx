import { useState } from 'react'
import type { ChangeEvent, FC, KeyboardEvent } from 'react'
import { } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import AutosizeInput from 'react-18-input-autosize'
import { RiAddLine, RiCloseLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import { useToastContext } from '@/app/components/base/toast'

type TagInputProps = {
  items: string[]
  onChange: (items: string[]) => void
  disableRemove?: boolean
  disableAdd?: boolean
  customizedConfirmKey?: 'Enter' | 'Tab'
  isInWorkflow?: boolean
  placeholder?: string
}

const TagInput: FC<TagInputProps> = ({
  items,
  onChange,
  disableAdd,
  disableRemove,
  customizedConfirmKey = 'Enter',
  isInWorkflow,
  placeholder,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)

  const isSpecialMode = customizedConfirmKey === 'Tab'

  const handleRemove = (index: number) => {
    const copyItems = [...items]
    copyItems.splice(index, 1)

    onChange(copyItems)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isSpecialMode && e.key === 'Enter')
      setValue(`${value}↵`)

    if (e.key === customizedConfirmKey) {
      if (isSpecialMode)
        e.preventDefault()

      const valueTrimmed = value.trim()
      if (!valueTrimmed || (items.find(item => item === valueTrimmed)))
        return

      if (valueTrimmed.length > 20) {
        notify({ type: 'error', message: t('datasetDocuments.segment.keywordError') })
        return
      }

      onChange([...items, valueTrimmed])
      setTimeout(() => {
        setValue('')
      })
    }
  }

  const handleBlur = () => {
    setValue('')
    setFocused(false)
  }

  return (
    <div className={cn('flex flex-wrap', !isInWorkflow && 'min-w-[200px]', isSpecialMode ? 'bg-gray-100 rounded-lg pb-1 pl-1' : '')}>
      {
        (items || []).map((item, index) => (
          <div
            key={item}
            className={cn('flex items-center mr-1 mt-1 pl-1.5 pr-1 py-1 system-xs-regular text-text-secondary border border-divider-deep bg-components-badge-white-to-dark rounded-md')}
          >
            {item}
            {
              !disableRemove && (
                <div className='flex items-center justify-center w-4 h-4 cursor-pointer' onClick={() => handleRemove(index)}>
                  <RiCloseLine className='ml-0.5 w-3.5 h-3.5 text-text-tertiary' />
                </div>
              )
            }
          </div>
        ))
      }
      {
        !disableAdd && (
          <div className={cn('flex items-center gap-x-0.5 mt-1 group/tag-add', !isSpecialMode ? 'px-1.5 rounded-md border border-dashed border-divider-deep' : '')}>
            {!isSpecialMode && !focused && <RiAddLine className='w-3.5 h-3.5 text-text-placeholder group-hover/tag-add:text-text-secondary' />}
            <AutosizeInput
              inputClassName={cn('outline-none appearance-none placeholder:text-text-placeholder caret-[#295EFF] group-hover/tag-add:placeholder:text-text-secondary', isSpecialMode ? 'bg-transparent' : '')}
              className={cn(
                !isInWorkflow && 'max-w-[300px]',
                isInWorkflow && 'max-w-[146px]',
                `
                py-1 rounded-md overflow-hidden system-xs-regular
                ${focused && isSpecialMode && 'px-1.5 border border-dashed border-divider-deep'}
              `)}
              onFocus={() => setFocused(true)}
              onBlur={handleBlur}
              value={value}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setValue(e.target.value)
              }}
              onKeyDown={handleKeyDown}
              placeholder={t(placeholder || (isSpecialMode ? 'common.model.params.stop_sequencesPlaceholder' : 'datasetDocuments.segment.addKeyWord'))}
            />
          </div>
        )
      }
    </div>
  )
}

export default TagInput
