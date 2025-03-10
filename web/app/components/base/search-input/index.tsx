import type { FC } from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseCircleFill, RiSearchLine } from '@remixicon/react'
import cn from '@/utils/classnames'

type SearchInputProps = {
  placeholder?: string
  className?: string
  value: string
  onChange: (v: string) => void
  white?: boolean
}

const SearchInput: FC<SearchInputProps> = ({
  placeholder,
  className,
  value,
  onChange,
  white,
}) => {
  const { t } = useTranslation()
  const [focus, setFocus] = useState<boolean>(false)
  const isComposing = useRef<boolean>(false)
  const [internalValue, setInternalValue] = useState<string>(value)

  return (
    <div className={cn(
      'group flex items-center px-2 h-8 rounded-lg bg-components-input-bg-normal hover:bg-components-input-bg-hover border-none overflow-hidden',
      focus && '!bg-components-input-bg-active',
      white && '!bg-white hover:!bg-white shadow-xs !border-gray-300 hover:!border-gray-300',
      className,
    )}>
      <div className="pointer-events-none shrink-0 flex items-center mr-1.5 justify-center w-4 h-4">
        <RiSearchLine className="h-4 w-4 text-components-input-text-placeholder" aria-hidden="true" />
      </div>
      <input
        type="text"
        name="query"
        className={cn(
          'grow block h-[18px] bg-transparent border-0 text-components-input-text-filled system-sm-regular placeholder:text-components-input-text-placeholder appearance-none outline-none caret-#295EFF',
          white && '!bg-white hover:!bg-white group-hover:!bg-white placeholder:!text-gray-400',
        )}
        placeholder={placeholder || t('common.operation.search')!}
        value={internalValue}
        onChange={(e) => {
          setInternalValue(e.target.value)
          if (!isComposing.current)
            onChange(e.target.value)
        }}
        onCompositionStart={() => {
          isComposing.current = true
        }}
        onCompositionEnd={(e) => {
          isComposing.current = false
          onChange(e.data)
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        autoComplete="off"
      />
      {value && (
        <div
          className='shrink-0 flex items-center justify-center w-4 h-4 cursor-pointer group/clear'
          onClick={() => {
            onChange('')
            setInternalValue('')
          }}
        >
          <RiCloseCircleFill className='w-4 h-4 text-text-quaternary group-hover/clear:text-text-tertiary' />
        </div>
      )}
    </div>
  )
}

export default SearchInput
