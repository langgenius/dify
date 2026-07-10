import type { ChangeEvent, KeyboardEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TagInputProps = {
  items: string[]
  onChange: (items: string[]) => void
  disableRemove?: boolean
  disableAdd?: boolean
  customizedConfirmKey?: 'Enter' | 'Tab'
  isInWorkflow?: boolean
  placeholder?: string
  required?: boolean
  inputClassName?: string
}

const TagInput = ({ items, onChange, disableAdd, disableRemove, customizedConfirmKey = 'Enter', isInWorkflow, placeholder, required = false, inputClassName }: TagInputProps) => {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const isSpecialMode = customizedConfirmKey === 'Tab'
  const inputPlaceholder = placeholder || (isSpecialMode ? t($ => $['model.params.stop_sequencesPlaceholder'], { ns: 'common' }) : t($ => $['segment.addKeyWord'], { ns: 'datasetDocuments' }))
  const handleRemove = (index: number) => {
    const copyItems = [...items]
    copyItems.splice(index, 1)
    onChange(copyItems)
  }
  const handleNewTag = useCallback((value: string) => {
    const valueTrimmed = value.trim()
    if (!valueTrimmed) {
      if (required)
        toast.error(t($ => $['segment.keywordEmpty'], { ns: 'datasetDocuments' }))
      return
    }
    if ((items.find(item => item === valueTrimmed))) {
      toast.error(t($ => $['segment.keywordDuplicate'], { ns: 'datasetDocuments' }))
      return
    }
    if (valueTrimmed.length > 20) {
      toast.error(t($ => $['segment.keywordError'], { ns: 'datasetDocuments' }))
      return
    }
    onChange([...items, valueTrimmed])
    setTimeout(() => {
      setValue('')
    })
  }, [items, onChange, t, required])
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
      {(items || []).map((item, index) => (
        <div key={item} className={cn('mt-1 mr-1 flex items-center rounded-md border border-divider-deep bg-components-badge-white-to-dark py-1 pr-1 pl-1.5 system-xs-regular text-text-secondary')}>
          {item}
          {!disableRemove && (
            <button
              type="button"
              aria-label={`${t($ => $['operation.remove'], { ns: 'common' })} ${item}`}
              className="flex size-4 cursor-pointer items-center justify-center border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              onClick={() => handleRemove(index)}
            >
              <span className="ml-0.5 i-ri-close-line size-3.5 text-text-tertiary" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {!disableAdd && (
        <div className={cn('group/tag-add mt-1 flex items-center gap-x-0.5', !isSpecialMode ? 'rounded-md border border-dashed border-divider-deep px-1.5' : '')}>
          {!isSpecialMode && !focused && <span className="i-ri-add-line size-3.5 text-text-placeholder group-hover/tag-add:text-text-secondary" />}
          <span
            data-input-value={value || inputPlaceholder}
            className={cn(!isInWorkflow && 'max-w-[300px]', isInWorkflow && 'max-w-[146px]', 'grid overflow-hidden rounded-md py-1 system-xs-regular after:invisible after:col-start-1 after:row-start-1 after:whitespace-pre after:content-[attr(data-input-value)]', isSpecialMode && 'border border-transparent px-1.5', focused && isSpecialMode && 'border-dashed border-divider-deep')}
          >
            <input
              className={cn('col-start-1 row-start-1 w-full min-w-0 appearance-none text-text-primary caret-[#295EFF] outline-hidden placeholder:text-text-placeholder group-hover/tag-add:placeholder:text-text-secondary', isSpecialMode ? 'bg-transparent' : '', inputClassName)}
              onFocus={() => setFocused(true)}
              onBlur={handleBlur}
              value={value}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setValue(e.target.value)
              }}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
            />
          </span>
        </div>
      )}
    </div>
  )
}
export default TagInput
