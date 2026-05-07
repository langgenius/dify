import type { ChangeEvent, FC, KeyboardEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import _AutosizeInput from 'react-18-input-autosize'
import { useTranslation } from 'react-i18next'
// CJS/ESM interop: Turbopack may resolve the module namespace object instead of the default export
// eslint-disable-next-line ts/no-explicit-any
const AutosizeInput = ('default' in (_AutosizeInput as any) ? (_AutosizeInput as any).default : _AutosizeInput) as typeof _AutosizeInput
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
const TagInput: FC<TagInputProps> = ({ items, onChange, disableAdd, disableRemove, customizedConfirmKey = 'Enter', isInWorkflow, placeholder, required = false, inputClassName }) => {
  const { t } = useTranslation()
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
      if (required)
        toast.error(t('segment.keywordEmpty', { ns: 'datasetDocuments' }))
      return
    }
    if ((items.find(item => item === valueTrimmed))) {
      toast.error(t('segment.keywordDuplicate', { ns: 'datasetDocuments' }))
      return
    }
    if (valueTrimmed.length > 20) {
      toast.error(t('segment.keywordError', { ns: 'datasetDocuments' }))
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
            <div className="flex h-4 w-4 cursor-pointer items-center justify-center" onClick={() => handleRemove(index)}>
              <span className="ml-0.5 i-ri-close-line h-3.5 w-3.5 text-text-tertiary" data-testid="remove-tag" />
            </div>
          )}
        </div>
      ))}
      {!disableAdd && (
        <div className={cn('group/tag-add mt-1 flex items-center gap-x-0.5', !isSpecialMode ? 'rounded-md border border-dashed border-divider-deep px-1.5' : '')}>
          {!isSpecialMode && !focused && <span className="i-ri-add-line h-3.5 w-3.5 text-text-placeholder group-hover/tag-add:text-text-secondary" />}
          <AutosizeInput
            inputClassName={cn('appearance-none text-text-primary caret-[#295EFF] outline-hidden placeholder:text-text-placeholder group-hover/tag-add:placeholder:text-text-secondary', isSpecialMode ? 'bg-transparent' : '', inputClassName)}
            className={cn(!isInWorkflow && 'max-w-[300px]', isInWorkflow && 'max-w-[146px]', 'overflow-hidden rounded-md py-1 system-xs-regular', isSpecialMode && 'border border-transparent px-1.5', focused && isSpecialMode && 'border-dashed border-divider-deep')}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setValue(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || (isSpecialMode ? t('model.params.stop_sequencesPlaceholder', { ns: 'common' }) : t('segment.addKeyWord', { ns: 'datasetDocuments' }))}
          />
        </div>
      )}
    </div>
  )
}
export default TagInput
