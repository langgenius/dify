'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import useAvailableVarList from '../../../../_base/hooks/use-available-var-list'
import RemoveButton from '@/app/components/workflow/nodes/_base/components/remove-button'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import type { Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
type Props = {
  className?: string
  nodeId: string
  value: string
  onChange: (newValue: string) => void
  hasRemove: boolean
  onRemove?: () => void
  placeholder?: string
  readOnly?: boolean
}

const InputItem: FC<Props> = ({
  className,
  nodeId,
  value,
  onChange,
  hasRemove,
  onRemove,
  placeholder,
  readOnly,
}) => {
  const { t } = useTranslation()

  const hasValue = !!value

  const [isFocus, setIsFocus] = useState(false)
  const availableVarList = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number].includes(varPayload.type)
    },
  })

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onRemove?.()
  }, [onRemove])

  return (
    <div className={cn(className, 'hover:bg-gray-50 hover:cursor-text', 'relative flex h-full items-center')}>
      {(!readOnly)
        ? (
          // <input
          //   type='text'
          //   className='w-full h-[18px] leading-[18px] pl-0.5  text-gray-900 text-xs font-normal placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
          //   value={value}
          //   onChange={handleChange}
          //   onBlur={setIsEditFalse}
          //   autoFocus
          //   placeholder={placeholder}
          //   readOnly={readOnly}
          // />
          <Input
            className={cn(isFocus ? 'bg-gray-100' : 'bg-width', 'w-0 grow px-3 py-1')}
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            nodesOutputVars={availableVarList}
            onFocusChange={setIsFocus}
            placeholder={t('workflow.nodes.http.insertVarPlaceholder')!}
            placeholderClassName='!leading-[21px]'
          />
        )
        : <div
          className="pl-0.5 w-full h-[18px] leading-[18px]"
        >
          {!hasValue && <div className='text-gray-300 text-xs font-normal'>{placeholder}</div>}
          {hasValue && (
            <Input
              className={cn(isFocus ? 'shadow-xs bg-gray-50 border-gray-300' : 'bg-gray-100 border-gray-100', 'w-0 grow rounded-lg px-3 py-[6px] border')}
              value={value}
              onChange={onChange}
              readOnly={readOnly}
              nodesOutputVars={availableVarList}
              onFocusChange={setIsFocus}
              placeholder={t('workflow.nodes.http.insertVarPlaceholder')!}
              placeholderClassName='!leading-[21px]'
            />
          )}
          {hasRemove && !isFocus && (
            <RemoveButton
              className='group-hover:block hidden absolute right-1 top-0.5'
              onClick={handleRemove}
            />
          )}
        </div>}
    </div>
  )
}
export default React.memo(InputItem)
