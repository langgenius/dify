'use client'
import type { FC } from 'react'
import type { ValueSelector, Var, Variable } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useDebounceFn } from 'ahooks'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { useKeyboardSortable } from '@/app/components/base/keyboard-sortable/use-keyboard-sortable'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { checkKeys, replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'
import RemoveButton from '../remove-button'
import VarReferencePicker from './var-reference-picker'

type Props = Readonly<{
  nodeId: string
  readonly: boolean
  list: Variable[]
  onChange: (list: Variable[]) => void
  onVarNameChange?: (oldName: string, newName: string) => void
  isSupportConstantValue?: boolean
  onlyLeafNodeVar?: boolean
  filterVar?: (payload: Var, valueSelector: ValueSelector) => boolean
  isSupportFileVar?: boolean
}>

const VarList: FC<Props> = ({
  nodeId,
  readonly,
  list,
  onChange,
  onVarNameChange,
  isSupportConstantValue,
  onlyLeafNodeVar,
  filterVar,
  isSupportFileVar = true,
}) => {
  const { t } = useTranslation()
  const variableNameLabel = t(($) => $['common.variableNamePlaceholder'], { ns: 'workflow' })

  const keyboardSort = useKeyboardSortable({
    items: list,
    onChange,
    disabled: readonly,
    getItemLabel: (item) => item.variable,
  })

  const listWithIds = useMemo(
    () =>
      keyboardSort.items.map((item, index) => ({
        id: index,
        variable: { ...item },
      })),
    [keyboardSort.items],
  )

  const { run: validateVarInput } = useDebounceFn(
    (list: Variable[], newKey: string) => {
      const result = checkKeys([newKey], true)
      if (!result.isValid) {
        toast.error(
          t(($) => $[`varKeyError.${result.errorMessageKey}`], {
            ns: 'appDebug',
            key: result.errorKey,
          }),
        )
        return
      }
      if (list.some((item) => item.variable?.trim() === newKey.trim())) {
        toast.error(t(($) => $['varKeyError.keyAlreadyExists'], { ns: 'appDebug', key: newKey }))
      }
    },
    { wait: 500 },
  )

  const handleVarNameChange = useCallback(
    (index: number) => {
      return (e: React.ChangeEvent<HTMLInputElement>) => {
        replaceSpaceWithUnderscoreInVarNameInput(e.target)

        const newKey = e.target.value

        validateVarInput(
          list.filter((_, itemIndex) => itemIndex !== index),
          newKey,
        )

        onVarNameChange?.(list[index]!.variable, newKey)
        const newList = produce(list, (draft) => {
          draft[index]!.variable = newKey
        })
        onChange(newList)
      }
    },
    [list, onVarNameChange, onChange, validateVarInput],
  )

  const handleVarReferenceChange = useCallback(
    (index: number) => {
      return (value: ValueSelector | string, varKindType: VarKindType, varInfo?: Var) => {
        const newList = produce(list, (draft) => {
          if (!isSupportConstantValue || varKindType === VarKindType.variable) {
            draft[index]!.value_selector = value as ValueSelector
            draft[index]!.value_type = varInfo?.type
            if (isSupportConstantValue) draft[index]!.variable_type = VarKindType.variable

            if (!draft[index]!.variable) {
              const variables = draft.map((v) => v.variable)
              let newVarName = value[value.length - 1]!
              let count = 1
              while (variables.includes(newVarName!)) {
                newVarName = `${value[value.length - 1]}_${count}`
                count++
              }
              draft[index]!.variable = newVarName
            }
          } else {
            draft[index]!.variable_type = VarKindType.constant
            draft[index]!.value_selector = value as ValueSelector
            draft[index]!.value = value as string
          }
        })
        onChange(newList)
      }
    },
    [isSupportConstantValue, list, onChange],
  )

  const handleVarRemove = useCallback(
    (index: number) => {
      return () => {
        const newList = produce(list, (draft) => {
          draft.splice(index, 1)
        })
        onChange(newList)
      }
    },
    [list, onChange],
  )

  const varCount = list.length

  return (
    <>
      {keyboardSort.announcement}
      <ReactSortable
        className="space-y-2"
        list={listWithIds}
        disabled={readonly || keyboardSort.isSorting}
        setList={(list) => {
          if (
            keyboardSort.isSorting ||
            list.every((item, index) => item.id === listWithIds[index]?.id)
          )
            return
          onChange(list.map((item) => item.variable))
        }}
        handle=".handle"
        ghostClass="opacity-50"
        animation={150}
      >
        {keyboardSort.items.map((variable, index) => {
          const canDrag = (() => {
            if (readonly) return false
            return varCount > 1
          })()
          return (
            <div
              className={cn('flex items-center gap-x-1', 'group relative')}
              key={keyboardSort.getItemKey(index)}
            >
              {canDrag && (
                <IconButton
                  {...keyboardSort.getHandleProps(index)}
                  className="handle pointer-events-none absolute top-1 -left-6 size-6 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100 aria-pressed:pointer-events-auto aria-pressed:opacity-100"
                >
                  <span aria-hidden="true" className="i-ri-draggable size-3" />
                </IconButton>
              )}
              <Input
                aria-label={variableNameLabel}
                className="w-30"
                disabled={readonly}
                value={variable.variable}
                onChange={handleVarNameChange(keyboardSort.getItemKey(index))}
                placeholder={variableNameLabel}
              />
              <VarReferencePicker
                nodeId={nodeId}
                readonly={readonly}
                isShowNodeName
                className="grow"
                value={
                  variable.variable_type === VarKindType.constant
                    ? variable.value || ''
                    : variable.value_selector || []
                }
                isSupportConstantValue={isSupportConstantValue}
                onChange={handleVarReferenceChange(keyboardSort.getItemKey(index))}
                defaultVarKindType={variable.variable_type}
                onlyLeafNodeVar={onlyLeafNodeVar}
                filterVar={filterVar}
                isSupportFileVar={isSupportFileVar}
              />
              {!readonly && (
                <RemoveButton onClick={handleVarRemove(keyboardSort.getItemKey(index))} />
              )}
            </div>
          )
        })}
      </ReactSortable>
    </>
  )
}
export default React.memo(VarList)
