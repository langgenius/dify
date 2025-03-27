import React, { type FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Textarea from '@/app/components/base/textarea'

export type AdvancedOptionsType = {
  enum: string
}

type AdvancedOptionsProps = {
  options: AdvancedOptionsType
  onChange: (options: AdvancedOptionsType) => void
}

const AdvancedOptions: FC<AdvancedOptionsProps> = ({
  onChange,
  options,
}) => {
  const { t } = useTranslation()
  // const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const [enumValue, setEnumValue] = useState(options.enum)

  const handleEnumChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEnumValue(e.target.value)
  }, [])

  const handleEnumBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    onChange({ enum: e.target.value })
  }, [onChange])

  // const handleToggleAdvancedOptions = useCallback(() => {
  //   setShowAdvancedOptions(prev => !prev)
  // }, [])

  return (
    <div className='border-t border-divider-subtle'>
      {/* {showAdvancedOptions ? ( */}
      <div className='flex flex-col gap-y-1 px-2 py-1.5'>
        <div className='flex w-full items-center gap-x-2'>
          <span className='system-2xs-medium-uppercase text-text-tertiary'>
            {t('workflow.nodes.llm.jsonSchema.stringValidations')}
          </span>
          <div className='grow'>
            <Divider type='horizontal' className='my-0 h-px bg-line-divider-bg' />
          </div>
        </div>
        <div className='flex flex-col'>
          <div className='system-xs-medium flex h-6 items-center text-text-secondary'>
            Enum
          </div>
          <Textarea
            size='small'
            className='min-h-6'
            value={enumValue}
            onChange={handleEnumChange}
            onBlur={handleEnumBlur}
            placeholder={'abcd, 1, 1.5, etc.'}
          />
        </div>
      </div>
      {/* ) : (
        <button
          type='button'
          className='flex items-center gap-x-0.5 pb-1 pl-1.5 pr-2 pt-2'
          onClick={handleToggleAdvancedOptions}
        >
          <RiArrowDownDoubleLine className='h-3 w-3 text-text-tertiary' />
          <span className='system-xs-regular text-text-tertiary'>
            {t('workflow.nodes.llm.jsonSchema.showAdvancedOptions')}
          </span>
        </button>
      )} */}
    </div>
  )
}

export default React.memo(AdvancedOptions)
