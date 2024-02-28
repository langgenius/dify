'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect } from 'react'
import produce from 'immer'
import cn from 'classnames'
import type { Body } from '../../types'
import { BodyType } from '../../types'
import useKeyValueList from '../../hooks/use-key-value-list'
import KeyValue from '../key-value'
import TextEditor from '../../../_base/components/editor/text-editor'
import CodeEditor from '../../../_base/components/editor/code-editor'

type Props = {
  readonly: boolean
  payload: Body
  onChange: (newPayload: Body) => void
}

const allTypes = [
  BodyType.none,
  BodyType.formData,
  BodyType.xWwwFormUrlencoded,
  BodyType.rawText,
  BodyType.json,
]
const bodyTextMap = {
  [BodyType.none]: 'none',
  [BodyType.formData]: 'form-data',
  [BodyType.xWwwFormUrlencoded]: 'x-www-form-urlencoded',
  [BodyType.rawText]: 'raw text',
  [BodyType.json]: 'JSON',
}

const EditBody: FC<Props> = ({
  readonly,
  payload,
  onChange,
}) => {
  const { type } = payload

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newType = e.target.value as BodyType
    onChange({
      type: newType,
      data: '',
    })
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    setBody([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange])

  const {
    list: body,
    setList: setBody,
    addItem: addBody,
    isKeyValueEdit: isBodyKeyValueEdit,
    toggleIsKeyValueEdit: toggleIsBodyKeyValueEdit,
  } = useKeyValueList(payload.data)

  const isCurrentKeyValue = type === BodyType.formData || type === BodyType.xWwwFormUrlencoded

  useEffect(() => {
    if (!isCurrentKeyValue)
      return

    const newBody = produce(payload, (draft: Body) => {
      draft.data = body.map((item) => {
        if (!item.key && !item.value)
          return ''
        return `${item.key}:${item.value}`
      }).join('\n')
    })
    onChange(newBody)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, isCurrentKeyValue])

  const handleBodyValueChange = useCallback((value: string) => {
    const newBody = produce(payload, (draft: Body) => {
      draft.data = value
    })
    onChange(newBody)
  }, [onChange, payload])

  return (
    <div>
      {/* body type */}
      <div className='flex flex-wrap'>
        {allTypes.map(t => (
          <label key={t} htmlFor={`body-type-${t}`} className='mr-4 flex items-center h-7 space-x-2'>
            <input
              type="radio"
              id={`body-type-${t}`}
              value={t}
              checked={type === t}
              onChange={handleTypeChange}
            />
            <div className='leading-[18px] text-[13px] font-normal text-gray-700'>{bodyTextMap[t]}</div>
          </label>
        ))}
      </div>
      {/* body value */}
      <div className={cn(type !== BodyType.none && 'mt-1')}>
        {type === BodyType.none && null}
        {(type === BodyType.formData || type === BodyType.xWwwFormUrlencoded) && (
          <KeyValue
            readonly={readonly}
            list={body}
            onChange={setBody}
            onAdd={addBody}
            isKeyValueEdit={isBodyKeyValueEdit}
            toggleKeyValueEdit={toggleIsBodyKeyValueEdit}
          />
        )}

        {type === BodyType.rawText && (
          <TextEditor
            title={<div className='uppercase'>Raw text</div>}
            onChange={handleBodyValueChange}
            value={payload.data}
            minHeight={150}
          />
        )}

        {type === BodyType.json && (
          <CodeEditor
            title={<div className='uppercase'>JSON</div>}
            value={payload.data} onChange={handleBodyValueChange}
          />
        )}
      </div>
    </div>
  )
}
export default React.memo(EditBody)
