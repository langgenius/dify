import {
  memo,
  useCallback,
  useState,
} from 'react'
import Textarea from 'rc-textarea'
import { useTranslation } from 'react-i18next'

type TitleInputProps = {
  value: string
  onBlur: (value: string) => void
}

export const TitleInput = memo(({
  value,
  onBlur,
}: TitleInputProps) => {
  const { t } = useTranslation()
  const [localValue, setLocalValue] = useState(value)

  const handleBlur = () => {
    if (!localValue) {
      setLocalValue(value)
      onBlur(value)
      return
    }

    onBlur(localValue)
  }

  return (
    <input
      value={localValue}
      onChange={e => setLocalValue(e.target.value)}
      className={`
        grow mr-2 px-1 h-6 system-xl-semibold text-text-primary rounded-lg border border-transparent appearance-none outline-none
        placeholder:text-text-placeholder
        bg-transparent hover:bg-state-base-hover
        focus:border-components-input-border-active focus:shadow-xs shadow-shadow-shadow-3 focus:bg-components-input-active caret-[#295EFF]
        min-w-0
      `}
      placeholder={t('workflow.common.addTitle') || ''}
      onBlur={handleBlur}
    />
  )
})
TitleInput.displayName = 'TitleInput'

type DescriptionInputProps = {
  value: string
  onChange: (value: string) => void
}
export const DescriptionInput = memo(({
  value,
  onChange,
}: DescriptionInputProps) => {
  const { t } = useTranslation()
  const [focus, setFocus] = useState(false)
  const handleFocus = useCallback(() => {
    setFocus(true)
  }, [])
  const handleBlur = useCallback(() => {
    setFocus(false)
  }, [])

  return (
    <div
      className={`
        group flex px-2 py-[5px] max-h-[60px] rounded-lg overflow-y-auto
        border border-transparent bg-transparent hover:bg-state-base-hover leading-0
        ${focus && '!border-components-input-border-active shadow-xs shadow-shadow-shadow-3 !bg-components-input-bg-active'}
      `}
    >
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={1}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={`
          w-full text-xs text-text-primary leading-[18px] bg-transparent
          appearance-none outline-none resize-none
          placeholder:text-text-placeholder caret-[#295EFF]
        `}
        placeholder={t('workflow.common.addDescription') || ''}
        autoSize
      />
    </div>
  )
})
DescriptionInput.displayName = 'DescriptionInput'
