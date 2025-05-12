import {
  memo,
  useCallback,
  useState,
} from 'react'
import Textarea from 'react-textarea-autosize'
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
        system-xl-semibold mr-2 h-7 min-w-0 grow appearance-none rounded-md border border-transparent bg-transparent px-1 text-text-primary
        outline-none focus:shadow-xs
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
        leading-0 group flex max-h-[60px] overflow-y-auto rounded-lg bg-components-panel-bg
        px-2 py-[5px]
        ${focus && '!shadow-xs'}
      `}
    >
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        minRows={1}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={`
          w-full resize-none appearance-none bg-transparent text-xs
          leading-[18px] text-text-primary caret-[#295EFF]
          outline-none placeholder:text-text-quaternary
        `}
        placeholder={t('workflow.common.addDescription') || ''}
      />
    </div>
  )
})
DescriptionInput.displayName = 'DescriptionInput'
