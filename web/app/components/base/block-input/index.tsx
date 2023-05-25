'use client'

import type { ChangeEvent, FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import classNames from 'classnames'
import { checkKeys } from '@/utils/var'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Toast from '../toast'
import { varHighlightHTML } from '../../app/configuration/base/var-highlight'

// regex to match the {{}} and replace it with a span
const regex = /\{\{([^}]+)\}\}/g

export const getInputKeys = (value: string) => {
  const keys = value.match(regex)?.map((item) => {
    return item.replace('{{', '').replace('}}', '')
  }) || []
  const keyObj: Record<string, boolean> = {}
  // remove duplicate keys
  const res: string[] = []
  keys.forEach((key) => {
    if (keyObj[key])
      return

    keyObj[key] = true
    res.push(key)
  })
  return res
}

export type IBlockInputProps = {
  value: string
  className?: string // wrapper class
  highLightClassName?: string // class for the highlighted text default is text-blue-500
  onConfirm?: (value: string, keys: string[]) => void
}

const BlockInput: FC<IBlockInputProps> = ({
  value = '',
  className,
  onConfirm,
}) => {
  const { t } = useTranslation()
  // current is used to store the current value of the contentEditable element
  const [currentValue, setCurrentValue] = useState<string>(value)
  useEffect(() => {
    setCurrentValue(value)
  }, [value])

  const isContentChanged = value !== currentValue

  const contentEditableRef = useRef<HTMLTextAreaElement>(null)
  const [isEditing, setIsEditing] = useState<boolean>(false)
  useEffect(() => {
    if (isEditing && contentEditableRef.current) {
      // TODO: Focus at the click positon
      if (currentValue) {
        contentEditableRef.current.setSelectionRange(currentValue.length, currentValue.length)
      }
      contentEditableRef.current.focus()
    }
  }, [isEditing])

  const style = classNames({
    'block px-4 py-1 w-full h-full text-sm text-gray-900 outline-0 border-0 break-all': true,
    'block-input--editing': isEditing,
  })

  const coloredContent = (currentValue || '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(regex, varHighlightHTML({ name: '$1' })) // `<span class="${highLightClassName}">{{$1}}</span>`
    .replace(/\n/g, '<br />')
    

  // Not use useCallback. That will cause out callback get old data.
  const handleSubmit = () => {
    if (onConfirm) {
      const value = currentValue
      const keys = getInputKeys(value)
      const { isValid, errorKey, errorMessageKey } = checkKeys(keys)
      if (!isValid) {
        Toast.notify({
          type: 'error',
          message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: errorKey })
        })
        return
      }
      onConfirm(value, keys)
      setIsEditing(false)
    }
  }

  const handleCancel = useCallback(() => {
    setIsEditing(false)
    setCurrentValue(value)
  }, [value])

  const onValueChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentValue(e.target.value)
  }, [])

  // Prevent rerendering caused cursor to jump to the start of the contentEditable element
  const TextAreaContentView = () => {
    return <div
      className={classNames(style, className)}
      dangerouslySetInnerHTML={{ __html: coloredContent }}
      suppressContentEditableWarning={true}
    />
  }

  const placeholder = ''
  const editAreaClassName = 'focus:outline-none bg-transparent text-sm'

  const textAreaContent = (
    <div className='h-[180px] overflow-y-auto' onClick={() => setIsEditing(true)}>
      {isEditing
        ? <div className='h-full px-4 py-1'>
          <textarea
            ref={contentEditableRef}
            className={classNames(editAreaClassName, 'block w-full h-full absolut3e resize-none')}
            placeholder={placeholder}
            onChange={onValueChange}
            value={currentValue}
            onBlur={() => {
              blur()
              if (!isContentChanged) {
                setIsEditing(false)
              }
              // click confirm also make blur. Then outter value is change. So below code has problem.
              // setTimeout(() => {
              //   handleCancel()
              // }, 1000)
            }}
          />
        </div>
        : <TextAreaContentView />}
    </div>)

  return (
    <div className={classNames('block-input w-full overflow-y-auto border-none rounded-lg')}>
      {textAreaContent}
      {/* footer */}
      <div className='flex item-center h-14 px-4'>
        {isContentChanged ? (
          <div className='flex items-center justify-between w-full'>
            <div className="h-[18px] leading-[18px] px-1 rounded-md bg-gray-100 text-xs text-gray-500">{currentValue.length}</div>
            <div className='flex space-x-2'>
              <Button
                onClick={handleCancel}
                className='w-20 !h-8 !text-[13px]'
              >
                {t('common.operation.cancel')}
              </Button>
              <Button
                onClick={handleSubmit}
                type="primary"
                className='w-20 !h-8 !text-[13px]'
              >
                {t('common.operation.confirm')}
              </Button>
            </div>

          </div>
        ) : (
          <p className="leading-5 text-xs text-gray-500">
            {t('appDebug.promptTip')}
          </p>
        )}
      </div>

    </div>
  )
}

export default React.memo(BlockInput)
