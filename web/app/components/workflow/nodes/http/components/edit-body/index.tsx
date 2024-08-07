'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect } from 'react'
import produce from 'immer'
import type { Body } from '../../types'
import { BodyType } from '../../types'
import useKeyValueList from '../../hooks/use-key-value-list'
import KeyValue from '../key-value'
import useAvailableVarList from '../../../_base/hooks/use-available-var-list'
import cn from '@/utils/classnames'
import InputWithVar from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import type { Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'

type Props = {
  readonly: boolean
  nodeId: string
  payload: Body
  onChange: (payload: Body) => void
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
  nodeId,
  payload,
  onChange,
}) => {
  const { type } = payload
  const { availableVars, availableNodes } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    },
  })

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

  const isCurrentKeyValue = type === BodyType.formData || type === BodyType.xWwwFormUrlencoded

  const {
    list: body,
    setList: setBody,
    addItem: addBody,
  } = useKeyValueList(payload.data, (value) => {
    if (!isCurrentKeyValue)
      return

    const newBody = produce(payload, (draft: Body) => {
      draft.data = value
    })
    onChange(newBody)
  }, type === BodyType.json)

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
  }, [isCurrentKeyValue])

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
              disabled={readonly}
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
            nodeId={nodeId}
            list={body}
            onChange={setBody}
            onAdd={addBody}
          />
        )}

        {type === BodyType.rawText && (
          <InputWithVar
            instanceId={'http-body-raw'}
            title={<div className='uppercase'>Raw text</div>}
            onChange={handleBodyValueChange}
            value={payload.data}
            justVar
            nodesOutputVars={availableVars}
            availableNodes={availableNodes}
            readOnly={readonly}
          />
        )}

        {type === BodyType.json && (
          <InputWithVar
            instanceId={'http-body-json'}
            title='JSON'
            value={payload.data}
            onChange={handleBodyValueChange}
            justVar
            nodesOutputVars={availableVars}
            availableNodes={availableNodes}
            readOnly={readonly}
          />
        )}
      </div>
    </div>
  )
}
export default React.memo(EditBody)
