import { useCallback, useState } from 'react'
import type { ChangeEvent, FC, KeyboardEvent } from 'react'
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

  const handleNewTag = useCallback((value: string) => {
    const valueTrimmed = value.trim()
    if (!valueTrimmed) {
      notify({ type: 'error', message: t('datasetDocuments.segment.keywordEmpty') })
      return
    }

    if ((items.find(item => item === valueTrimmed))) {
      notify({ type: 'error', message: t('datasetDocuments.segment.keywordDuplicate') })
      return
    }

    if (valueTrimmed.length > 20) {
      notify({ type: 'error', message: t('datasetDocuments.segment.keywordError') })
      return
    }

    onChange([...items, valueTrimmed])
    setTimeout(() => {
      setValue('')
    })
  }, [items, onChange, notify, t])

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isSpecialMode && e.key === 'Enter')
      setValue(`${value}↵`)

    if (e.key === customizedConfirmKey) {
      if (isSpecialMode)
        e.preventDefault()

      handleNewTag(value)
    }
  }

  const handleBlur = () => {
    handleNewTag(value)
    setFocused(false)
  }

  return (
    <div className={cn('flex flex-wrap', !isInWorkflow && 'min-w-[200px]', isSpecialMode ? 'rounded-lg bg-components-input-bg-normal pb-1 pl-1' : '')}>
      {
        (items || []).map((item, index) => (
          <div
            key={item}
            className={cn('system-xs-regular mr-1 mt-1 flex items-center rounded-md border border-divider-deep bg-components-badge-white-to-dark py-1 pl-1.5 pr-1 text-text-secondary')}
          >
            {item}
            {
              !disableRemove && (
                <div className='flex h-4 w-4 cursor-pointer items-center justify-center' onClick={() => handleRemove(index)}>
                  <RiCloseLine className='ml-0.5 h-3.5 w-3.5 text-text-tertiary' />
                </div>
              )
            }
          </div>
        ))
      }
      {
        !disableAdd && (
          <div className={cn('group/tag-add mt-1 flex items-center gap-x-0.5', !isSpecialMode ? 'rounded-md border border-dashed border-divider-deep px-1.5' : '')}>
            {!isSpecialMode && !focused && <RiAddLine className='h-3.5 w-3.5 text-text-placeholder group-hover/tag-add:text-text-secondary' />}
            <AutosizeInput
              inputClassName={cn('appearance-none text-text-primary caret-[#295EFF] outline-none placeholder:text-text-placeholder group-hover/tag-add:placeholder:text-text-secondary', isSpecialMode ? 'bg-transparent' : '')}
              className={cn(
                !isInWorkflow && 'max-w-[300px]',
                isInWorkflow && 'max-w-[146px]',
                `
                system-xs-regular overflow-hidden rounded-md py-1
                ${isSpecialMode && 'border border-transparent px-1.5'}
                ${focused && isSpecialMode && 'border-dashed border-divider-deep'}
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
