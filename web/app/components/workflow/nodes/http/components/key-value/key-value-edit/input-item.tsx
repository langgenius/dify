'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useAvailableVarList from '../../../../_base/hooks/use-available-var-list'
import cn from '@/utils/classnames'
import RemoveButton from '@/app/components/workflow/nodes/_base/components/remove-button'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import type { Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
type Props = {
  className?: string
  instanceId?: string
  nodeId: string
  value: string
  onChange: (newValue: string) => void
  hasRemove: boolean
  onRemove?: () => void
  placeholder?: string
  readOnly?: boolean
  isSupportFile?: boolean
  insertVarTipToLeft?: boolean
}

const InputItem: FC<Props> = ({
  className,
  instanceId,
  nodeId,
  value,
  onChange,
  hasRemove,
  onRemove,
  placeholder,
  readOnly,
  isSupportFile,
  insertVarTipToLeft,
}) => {
  const { t } = useTranslation()

  const hasValue = !!value

  const [isFocus, setIsFocus] = useState(false)
  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      const supportVarTypes = [VarType.string, VarType.number, VarType.secret]
      if (isSupportFile)
        supportVarTypes.push(...[VarType.file, VarType.arrayFile])

      return supportVarTypes.includes(varPayload.type)
    },
  })

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onRemove?.()
  }, [onRemove])

  return (
    <div className={cn(className, 'hover:bg-gray-50 hover:cursor-text', 'relative flex h-full')}>
      {(!readOnly)
        ? (
          <Input
            instanceId={instanceId}
            className={cn(isFocus ? 'bg-gray-100' : 'bg-width', 'w-0 grow px-3 py-1')}
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            nodesOutputVars={availableVars}
            availableNodes={availableNodesWithParent}
            onFocusChange={setIsFocus}
            placeholder={t('workflow.nodes.http.insertVarPlaceholder')!}
            placeholderClassName='!leading-[21px]'
            promptMinHeightClassName='h-full'
            insertVarTipToLeft={insertVarTipToLeft}
          />
        )
        : <div
          className="pl-0.5 w-full h-[18px] leading-[18px]"
        >
          {!hasValue && <div className='text-gray-300 text-xs font-normal'>{placeholder}</div>}
          {hasValue && (
            <Input
              instanceId={instanceId}
              className={cn(isFocus ? 'shadow-xs bg-gray-50 border-gray-300' : 'bg-gray-100 border-gray-100', 'w-0 grow rounded-lg px-3 py-[6px] border')}
              value={value}
              onChange={onChange}
              readOnly={readOnly}
              nodesOutputVars={availableVars}
              availableNodes={availableNodesWithParent}
              onFocusChange={setIsFocus}
              placeholder={t('workflow.nodes.http.insertVarPlaceholder')!}
              placeholderClassName='!leading-[21px]'
              promptMinHeightClassName='h-full'
              insertVarTipToLeft={insertVarTipToLeft}
            />
          )}

        </div>}
      {hasRemove && !isFocus && (
        <RemoveButton
          className='group-hover:block hidden absolute right-1 top-0.5'
          onClick={handleRemove}
        />
      )}
    </div>
  )
}
export default React.memo(InputItem)
