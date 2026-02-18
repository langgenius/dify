'use client'
import type { FC } from 'react'
import type { Var } from '@/app/components/workflow/types'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import RemoveButton from '@/app/components/workflow/nodes/_base/components/remove-button'
import { VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import useAvailableVarList from '../../../../_base/hooks/use-available-var-list'

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
        supportVarTypes.push(VarType.file, VarType.arrayFile)

      return supportVarTypes.includes(varPayload.type)
    },
  })

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onRemove?.()
  }, [onRemove])

  return (
    <div className={cn(className, 'hover:cursor-text hover:bg-state-base-hover', 'relative flex !h-[30px] items-center')}>
      {(!readOnly)
        ? (
            <Input
              instanceId={instanceId}
              className={cn(isFocus ? 'bg-components-input-bg-active' : 'bg-width', 'h-full w-0 grow px-3 py-1')}
              value={value}
              onChange={onChange}
              readOnly={readOnly}
              nodesOutputVars={availableVars}
              availableNodes={availableNodesWithParent}
              onFocusChange={setIsFocus}
              placeholder={t('nodes.http.insertVarPlaceholder', { ns: 'workflow' })!}
              placeholderClassName="!leading-[21px]"
              promptMinHeightClassName="h-full"
              insertVarTipToLeft={insertVarTipToLeft}
            />
          )
        : (
            <div
              className="h-full w-full pl-0.5 leading-[18px]"
            >
              {!hasValue && <div className="text-xs font-normal text-text-quaternary">{placeholder}</div>}
              {hasValue && (
                <Input
                  instanceId={instanceId}
                  className={cn(isFocus ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs' : 'border-components-input-border-hover bg-components-input-bg-normal', 'h-full w-0 grow rounded-lg border px-3 py-[6px]')}
                  value={value}
                  onChange={onChange}
                  readOnly={readOnly}
                  nodesOutputVars={availableVars}
                  availableNodes={availableNodesWithParent}
                  onFocusChange={setIsFocus}
                  placeholder={t('nodes.http.insertVarPlaceholder', { ns: 'workflow' })!}
                  placeholderClassName="!leading-[21px]"
                  promptMinHeightClassName="h-full"
                  insertVarTipToLeft={insertVarTipToLeft}
                />
              )}

            </div>
          )}
      {hasRemove && !isFocus && (
        <RemoveButton
          className="absolute right-1 top-0.5 hidden group-hover:block"
          onClick={handleRemove}
        />
      )}
    </div>
  )
}
export default React.memo(InputItem)
