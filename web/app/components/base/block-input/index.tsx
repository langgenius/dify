'use client'

import type { ChangeEvent, FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { varHighlightHTML } from '../../app/configuration/base/var-highlight'
import Toast from '../toast'
import classNames from '@/utils/classnames'
import { checkKeys } from '@/utils/var'

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
  readonly?: boolean
  onConfirm?: (value: string, keys: string[]) => void
}

const BlockInput: FC<IBlockInputProps> = ({
  value = '',
  className,
  readonly = false,
  onConfirm,
}) => {
  const { t } = useTranslation()
  // current is used to store the current value of the contentEditable element
  const [currentValue, setCurrentValue] = useState<string>(value)
  useEffect(() => {
    setCurrentValue(value)
  }, [value])

  const contentEditableRef = useRef<HTMLTextAreaElement>(null)
  const [isEditing, setIsEditing] = useState<boolean>(false)
  useEffect(() => {
    if (isEditing && contentEditableRef.current) {
      // TODO: Focus at the click positon
      if (currentValue)
        contentEditableRef.current.setSelectionRange(currentValue.length, currentValue.length)

      contentEditableRef.current.focus()
    }
  }, [isEditing])

  const style = classNames({
    'block px-4 py-2 w-full h-full text-sm text-gray-900 outline-0 border-0 break-all': true,
    'block-input--editing': isEditing,
  })

  const coloredContent = (currentValue || '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(regex, varHighlightHTML({ name: '$1' })) // `<span class="${highLightClassName}">{{$1}}</span>`
    .replace(/\n/g, '<br />')

  // Not use useCallback. That will cause out callback get old data.
  const handleSubmit = (value: string) => {
    if (onConfirm) {
      const keys = getInputKeys(value)
      const { isValid, errorKey, errorMessageKey } = checkKeys(keys)
      if (!isValid) {
        Toast.notify({
          type: 'error',
          message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: errorKey }),
        })
        return
      }
      onConfirm(value, keys)
    }
  }

  const onValueChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setCurrentValue(value)
    handleSubmit(value)
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
    <div className={classNames(readonly ? 'max-h-[180px] pb-5' : 'h-[180px]', ' overflow-y-auto')} onClick={() => !readonly && setIsEditing(true)}>
      {isEditing
        ? <div className='h-full px-4 py-2'>
          <textarea
            ref={contentEditableRef}
            className={classNames(editAreaClassName, 'block w-full h-full resize-none')}
            placeholder={placeholder}
            onChange={onValueChange}
            value={currentValue}
            onBlur={() => {
              blur()
              setIsEditing(false)
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
    <div className={classNames('block-input w-full overflow-y-auto bg-white border-none rounded-xl')}>
      {textAreaContent}
      {/* footer */}
      {!readonly && (
        <div className='pl-4 pb-2 flex'>
          <div className="h-[18px] leading-[18px] px-1 rounded-md bg-gray-100 text-xs text-gray-500">{currentValue?.length}</div>
        </div>
      )}

    </div>
  )
}

export default React.memo(BlockInput)
