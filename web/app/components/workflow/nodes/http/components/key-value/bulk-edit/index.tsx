'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Editor from '@/app/components/workflow/nodes/_base/components/editor/base'
import { LayoutGrid02 } from '@/app/components/base/icons/src/vender/line/layout'

const i18nPrefix = 'workflow.nodes.http'

type Props = {
  value: string
  onChange: (value: string) => void
  onSwitchToKeyValueEdit: () => void
}

const BulkEdit: FC<Props> = ({
  value,
  onChange,
  onSwitchToKeyValueEdit,
}) => {
  const { t } = useTranslation()
  const [tempValue, setTempValue] = React.useState(value)

  const [isFocus, setIsFocus] = React.useState(false)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTempValue(e.target.value)
  }, [])

  const handleSwitchToKeyValueEdit = useCallback(() => {
    onChange(tempValue)
    onSwitchToKeyValueEdit()
  }, [tempValue, onChange, onSwitchToKeyValueEdit])

  return (
    <div>
      <Editor
        title={<div className='uppercase'>{t(`${i18nPrefix}.bulkEdit`)}</div>}
        value={value}
        headerRight={
          <div className='flex items-center h-[18px]'>
            <div
              className='flex items-center space-x-1 cursor-pointer'
              onClick={handleSwitchToKeyValueEdit}
            >
              <LayoutGrid02 className='w-3 h-3 text-gray-500' />
              <div className='leading-[18px] text-xs font-normal text-gray-500'>{t(`${i18nPrefix}.keyValueEdit`)}</div>
            </div>
            <div className='ml-3 mr-1.5 w-px h-3 bg-gray-200'></div>
          </div>
        }
        isFocus={isFocus}
        minHeight={150}
      >
        <textarea
          value={tempValue}
          onChange={handleChange}
          onFocus={() => setIsFocus(true)}
          onBlur={() => setIsFocus(false)}
          className='w-full h-full p-3 resize-none bg-transparent'
        />
      </Editor>
    </div>
  )
}
export default React.memo(BulkEdit)
