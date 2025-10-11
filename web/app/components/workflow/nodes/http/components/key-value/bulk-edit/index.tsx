'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import TextEditor from '@/app/components/workflow/nodes/_base/components/editor/text-editor'
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

  const handleChange = useCallback((value: string) => {
    setTempValue(value)
  }, [])

  const handleBlur = useCallback(() => {
    onChange(tempValue)
  }, [tempValue, onChange])

  const handleSwitchToKeyValueEdit = useCallback(() => {
    onChange(tempValue)
    onSwitchToKeyValueEdit()
  }, [tempValue, onChange, onSwitchToKeyValueEdit])

  return (
    <div>
      <TextEditor
        isInNode
        title={<div className='uppercase'>{t(`${i18nPrefix}.bulkEdit`)}</div>}
        value={tempValue}
        onChange={handleChange}
        onBlur={handleBlur}
        headerRight={
          <div className='flex h-[18px] items-center'>
            <div
              className='flex cursor-pointer items-center space-x-1'
              onClick={handleSwitchToKeyValueEdit}
            >
              <LayoutGrid02 className='h-3 w-3 text-gray-500' />
              <div className='text-xs font-normal leading-[18px] text-gray-500'>{t(`${i18nPrefix}.keyValueEdit`)}</div>
            </div>
            <div className='ml-3 mr-1.5 h-3 w-px bg-gray-200'></div>
          </div>
        }
        minHeight={150}
      />
    </div>
  )
}
export default React.memo(BulkEdit)
