'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import type { FieldCondition, FilterItem } from '../types'
import VarReferencePicker from '../../_base/components/variable/var-reference-picker'
import type { ValueSelector, Var } from '../../../types'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import Selector from '@/app/components/workflow/nodes/_base/components/selector'

const i18nPrefix = 'workflow.nodes.knowledgeRetrieval.metadataFilterItem'

type Props = {
  index: number
  payload: FilterItem
  onRemove: () => void
  onChange: (filterItem: FilterItem) => void
  readonly: boolean
  nodeId: string
}

const MetadataFilterItem: FC<Props> = ({
  index,
  payload,
  onRemove,
  onChange,
  nodeId,
  readonly,
}) => {
  const canRemove = true
  const { t } = useTranslation()

  const OPERATORS = [
    { value: 'MatchAny', acceptType: ['array[string]', 'array[number]'] },
    { value: 'MatchExcept', acceptType: ['array[string]', 'array[number]'] },
    { value: 'MatchText', acceptType: ['string'] },
    { value: 'MatchValue', acceptType: ['string', 'number'] },
    { value: 'le', acceptType: ['number'] },
    { value: 'lt', acceptType: ['number'] },
    { value: 'ge', acceptType: ['number'] },
    { value: 'gt', acceptType: ['number'] },
  ]

  const getFilter = (condition: FieldCondition) => OPERATORS.find(o => o.value === condition)?.acceptType ?? []

  const handleParamChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...payload,
      key: e.target.value,
    })
  }, [payload, onChange])
  const handleOperatorChange = useCallback((v: FieldCondition) => {
    onChange({
      ...payload,
      field_condition: v,
    })
  }, [payload, onChange])
  const handleVarReferenceChange = useCallback((v: ValueSelector | string) => {
    onChange({
      ...payload,
      value_selector: v as ValueSelector,
    })
  }, [payload, onChange])

  const filterVar = React.useCallback((varPayload: Var) => {
    if (!payload.field_condition)
      return false
    return getFilter(payload.field_condition).includes(varPayload.type)
  }, [payload.field_condition])

  const getOperatorHoverTip = (v: FieldCondition | undefined | null | '') => {
    if (!v)
      return ''
    const i18nOperatorKey = v[0].toLowerCase() + v.slice(1)
    return t(`${i18nPrefix}.operator.${i18nOperatorKey}.hoverTip`)
  }

  const getOperatorLabel = (v: FieldCondition | undefined | null | '') => {
    if (!v)
      return ''
    const i18nOperatorKey = v[0].toLowerCase() + v.slice(1)
    return t(`${i18nPrefix}.operator.${i18nOperatorKey}.label`)
  }

  return (
    <div className='flex items-center space-x-1 box-border !mb-1 !mt-0'>
      <input
        readOnly={readonly}
        onClick={() => {
          if (readonly)
            return

          return ''
        }}
        value={payload.key}
        onChange={handleParamChange}
        placeholder={`${t(`${i18nPrefix}.params`)}${index + 1}`}
        className='min-w-[80px] flex-grow h-8 leading-8 px-2.5  rounded-lg border-0 bg-gray-100  text-gray-900 text-[13px]  placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
        type='text'
      />

      <Selector
        popupClassName='top-[34px]'
        itemClassName='capitalize'
        readonly={readonly}
        value={payload.field_condition ?? ''}
        options={OPERATORS.map(o => ({ value: o.value, label: getOperatorLabel(o.value as FieldCondition) }))}
        onChange={handleOperatorChange}
        trigger={
          <div
            onClick={(e) => {
              if (readonly) {
                e.stopPropagation()
                return
              }

              return ''
            }}
            title={getOperatorHoverTip(payload.field_condition)}
            className={cn(!readonly && 'cursor-pointer', 'shrink-0 w-[80px] whitespace-nowrap flex items-center h-8 justify-between px-2.5 rounded-lg bg-gray-100 capitalize')}
          >
            {
              !payload.field_condition
                ? <div className='text-[13px] font-normal text-gray-400'>{t(`${i18nPrefix}.operatorLabel`)}</div>
                : <div className='text-[13px] font-normal text-gray-900'>{getOperatorLabel(payload.field_condition)}</div>
            }

          </div>
        }
      />

      <VarReferencePicker
        nodeId={nodeId}
        readonly={readonly}
        isShowNodeName
        className='min-w-[170px] flex-grow'
        onChange={handleVarReferenceChange}
        value={payload.value_selector}
        filterVar={filterVar}
      />

      {!readonly && (
        <div
          className={cn(canRemove ? 'text-gray-500 bg-gray-100 hover:bg-gray-200  cursor-pointer' : 'bg-gray-25 text-gray-300', 'p-2 rounded-lg ')}
          onClick={canRemove ? onRemove : () => { }}
        >
          <Trash03 className='w-4 h-4 ' />
        </div>
      )}
    </div>
  )
}
export default React.memo(MetadataFilterItem)
