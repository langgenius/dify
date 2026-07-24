'use client'
import type { FC } from 'react'
import type { Body, BodyPayload, KeyValue as KeyValueType } from '../../types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { uniqueId } from 'es-toolkit/compat'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import InputWithVar from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import { VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import VarReferencePicker from '../../../_base/components/variable/var-reference-picker'
import useAvailableVarList from '../../../_base/hooks/use-available-var-list'
import { BodyPayloadValueType, BodyType } from '../../types'
import KeyValue from '../key-value'

const UNIQUE_ID_PREFIX = 'key-value-'

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
  BodyType.json,
  BodyType.rawText,
  BodyType.binary,
]
const bodyTextMap = {
  [BodyType.none]: 'none',
  [BodyType.formData]: 'form-data',
  [BodyType.xWwwFormUrlencoded]: 'x-www-form-urlencoded',
  [BodyType.rawText]: 'raw',
  [BodyType.json]: 'JSON',
  [BodyType.binary]: 'binary',
}

const EditBody: FC<Props> = ({
  readonly,
  nodeId,
  payload,
  onChange,
}) => {
  const { type, data } = payload
  const bodyPayload = useMemo(() => {
    if (typeof data === 'string') { // old data
      return []
    }
    return data
  }, [data])
  const stringValue = [BodyType.formData, BodyType.xWwwFormUrlencoded].includes(type) ? '' : (bodyPayload[0]?.value || '')

  const { availableVars, availableNodes } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret, VarType.arrayNumber, VarType.arrayString].includes(varPayload.type)
    },
  })

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newType = e.target.value as BodyType
    const hasKeyValue = [BodyType.formData, BodyType.xWwwFormUrlencoded].includes(newType)
    onChange({
      type: newType,
      data: hasKeyValue
        ? [
            {
              id: uniqueId(UNIQUE_ID_PREFIX),
              type: BodyPayloadValueType.text,
              key: '',
              value: '',
            },
          ]
        : [],
    })
  }, [onChange])

  const handleAddBody = useCallback(() => {
    const newPayload = produce(payload, (draft) => {
      (draft.data as BodyPayload).push({
        id: uniqueId(UNIQUE_ID_PREFIX),
        type: BodyPayloadValueType.text,
        key: '',
        value: '',
      })
    })
    onChange(newPayload)
  }, [onChange, payload])

  const handleBodyPayloadChange = useCallback((newList: KeyValueType[]) => {
    const newPayload = produce(payload, (draft) => {
      draft.data = newList as BodyPayload
    })
    onChange(newPayload)
  }, [onChange, payload])

  const filterOnlyFileVariable = (varPayload: Var) => {
    return [VarType.file, VarType.arrayFile].includes(varPayload.type)
  }

  const handleBodyValueChange = useCallback((value: string) => {
    const newBody = produce(payload, (draft: Body) => {
      if ((draft.data as BodyPayload).length === 0) {
        (draft.data as BodyPayload).push({
          id: uniqueId(UNIQUE_ID_PREFIX),
          type: BodyPayloadValueType.text,
          key: '',
          value: '',
        })
      }
      (draft.data as BodyPayload)[0].value = value
    })
    onChange(newBody)
  }, [onChange, payload])

  const handleFileChange = useCallback((value: ValueSelector | string) => {
    const newBody = produce(payload, (draft: Body) => {
      if ((draft.data as BodyPayload).length === 0) {
        (draft.data as BodyPayload).push({
          id: uniqueId(UNIQUE_ID_PREFIX),
          type: BodyPayloadValueType.file,
        })
      }
      (draft.data as BodyPayload)[0].file = value as ValueSelector
    })
    onChange(newBody)
  }, [onChange, payload])

  return (
    <div>
      {/* body type */}
      <div className="flex flex-wrap">
        {allTypes.map(t => (
          <label key={t} htmlFor={`body-type-${t}`} className="mr-4 flex h-7 items-center space-x-2">
            <input
              type="radio"
              id={`body-type-${t}`}
              value={t}
              checked={type === t}
              onChange={handleTypeChange}
              disabled={readonly}
            />
            <div className="text-[13px] font-normal leading-[18px] text-text-secondary">{bodyTextMap[t]}</div>
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
            list={bodyPayload as KeyValueType[]}
            onChange={handleBodyPayloadChange}
            onAdd={handleAddBody}
            isSupportFile={type === BodyType.formData}
          />
        )}

        {type === BodyType.rawText && (
          <InputWithVar
            instanceId="http-body-raw"
            title={<div className="uppercase">Raw text</div>}
            onChange={handleBodyValueChange}
            value={stringValue}
            justVar
            nodesOutputVars={availableVars}
            availableNodes={availableNodes}
            readOnly={readonly}
          />
        )}

        {type === BodyType.json && (
          <InputWithVar
            instanceId="http-body-json"
            title="JSON"
            value={stringValue}
            onChange={handleBodyValueChange}
            justVar
            nodesOutputVars={availableVars}
            availableNodes={availableNodes}
            readOnly={readonly}
          />
        )}

        {type === BodyType.binary && (
          <VarReferencePicker
            nodeId={nodeId}
            readonly={readonly}
            value={bodyPayload[0]?.file || []}
            onChange={handleFileChange}
            filterVar={filterOnlyFileVariable}
          />
        )}
      </div>
    </div>
  )
}
export default React.memo(EditBody)
