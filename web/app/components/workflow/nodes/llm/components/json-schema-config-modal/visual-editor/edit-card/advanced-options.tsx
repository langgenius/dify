import React, { type FC, useCallback, useState } from 'react'
import { RiArrowDownDoubleLine } from '@remixicon/react'
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
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const [enumValue, setEnumValue] = useState(options.enum)

  const handleEnumChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEnumValue(e.target.value)
  }, [])

  const handleEnumBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    onChange({ enum: e.target.value })
  }, [onChange])

  const handleToggleAdvancedOptions = useCallback(() => {
    setShowAdvancedOptions(prev => !prev)
  }, [])

  return (
    <div className='border-t border-divider-subtle'>
      {showAdvancedOptions ? (
        <div className='flex flex-col px-2 py-1.5 gap-y-1'>
          <div className='flex items-center gap-x-2 w-full'>
            <span className='text-text-tertiary system-2xs-medium-uppercase'>
              {t('workflow.nodes.llm.jsonSchema.stringValidations')}
            </span>
            <div className='grow'>
              <Divider type='horizontal' className='h-px my-0 bg-line-divider-bg' />
            </div>
          </div>
          <div className='flex flex-col'>
            <div className='flex items-center h-6 text-text-secondary system-xs-medium'>
              Enum
            </div>
            <Textarea
              size='small'
              className='min-h-6'
              value={enumValue}
              onChange={handleEnumChange}
              onBlur={handleEnumBlur}
              placeholder={'\'abcd\', 1, 1.5, \'etc\''}
            />
          </div>
        </div>
      ) : (
        <button
          type='button'
          className='flex items-center pl-1.5 pt-2 pr-2 pb-1 gap-x-0.5'
          onClick={handleToggleAdvancedOptions}
        >
          <RiArrowDownDoubleLine className='w-3 h-3 text-text-tertiary' />
          <span className='text-text-tertiary system-xs-regular'>
            {t('workflow.nodes.llm.jsonSchema.showAdvancedOptions')}
          </span>
        </button>
      )}
    </div>
  )
}

export default React.memo(AdvancedOptions)
