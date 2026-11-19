'use client'

import type { FC } from 'react'
import type { InputVar } from '@/app/components/workflow/types'
import type { PromptVariable } from '@/models/debug'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { createDialogHandle, Dialog } from '@langgenius/dify-ui/dialog'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useBoolean } from 'ahooks'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { useContext } from 'use-context-selector'
import { toast } from '@/app/components/app/configuration/toast'
import { useKeyboardSortable } from '@/app/components/base/keyboard-sortable/use-keyboard-sortable'
import { InputVarType } from '@/app/components/workflow/types'
import ConfigContext from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { getNewVar, hasDuplicateStr } from '@/utils/var'
import Panel from '../base/feature-panel'
import { ExternalDataToolDialogContent } from '../tools/external-data-tool-dialog-content'
import EditModal from './config-modal'
import SelectVarType from './select-var-type'
import VarItem from './var-item'

export const ADD_EXTERNAL_DATA_TOOL = 'ADD_EXTERNAL_DATA_TOOL'

const BASIC_INPUT_TYPES = new Set(['string', 'paragraph', 'select', 'number', 'checkbox'])

const toInputVar = (item: PromptVariable): InputVar => ({
  ...item,
  label: item.name,
  variable: item.key,
  type: (item.type === 'string' ? InputVarType.textInput : item.type) as InputVarType,
  required: item.required ?? false,
})

const buildPromptVariableFromInput = (payload: InputVar): PromptVariable => {
  const { variable, label, type, ...rest } = payload
  const nextType = type === InputVarType.textInput ? 'string' : type
  const nextItem: PromptVariable = {
    ...rest,
    type: nextType,
    key: variable,
    name: label as string,
  }

  if (payload.type !== InputVarType.select) delete nextItem.options

  return nextItem
}

const getDuplicateError = (list: PromptVariable[]) => {
  if (hasDuplicateStr(list.map((item) => item.key))) {
    return {
      errorMsgKey: 'varKeyError.keyAlreadyExists',
      typeName: 'variableConfig.varName',
    } as const
  }
  if (hasDuplicateStr(list.map((item) => item.name))) {
    return {
      errorMsgKey: 'varKeyError.keyAlreadyExists',
      typeName: 'variableConfig.labelName',
    } as const
  }
  return null
}

export type IConfigVarProps = {
  promptVariables: PromptVariable[]
  readonly?: boolean
  onPromptVariablesChange?: (promptVariables: PromptVariable[]) => void
}

const ConfigVar: FC<IConfigVarProps> = ({ promptVariables, readonly, onPromptVariablesChange }) => {
  const titleId = React.useId()

  const { t } = useTranslation(['appDebug', 'common'])
  const { mode, dataSets } = useContext(ConfigContext)
  const { eventEmitter } = useEventEmitterContextContext()

  const hasVar = promptVariables.length > 0
  const [currIndex, setCurrIndex] = useState<number>(-1)
  const currItem = currIndex !== -1 ? promptVariables[currIndex] : null
  const currItemToEdit = useMemo(() => {
    if (!currItem) return null
    return toInputVar(currItem)
  }, [currItem])
  const updatePromptVariableItem = useCallback(
    (payload: InputVar) => {
      const newPromptVariables = produce(promptVariables, (draft) => {
        draft[currIndex] = buildPromptVariableFromInput(payload)
      })
      const duplicateError = getDuplicateError(newPromptVariables)
      if (duplicateError) {
        toast.error(
          t(($) => $[duplicateError.errorMsgKey], {
            ns: 'appDebug',
            key: t(($) => $[duplicateError.typeName], { ns: 'appDebug' }),
          }),
        )
        return false
      }

      onPromptVariablesChange?.(newPromptVariables)
      return true
    },
    [currIndex, onPromptVariablesChange, promptVariables, t],
  )

  const [toolDialog] = useState(() => createDialogHandle<PromptVariable | null>())

  const handleAddVar = useCallback(
    (type: string) => {
      if (type === 'api') {
        toolDialog.openWithPayload(null)
        return
      }
      onPromptVariablesChange?.([...promptVariables, getNewVar('', type)])
    },
    [toolDialog, onPromptVariablesChange, promptVariables],
  )

  // oxlint-disable-next-line typescript/no-explicit-any
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === ADD_EXTERNAL_DATA_TOOL) {
      const payload = v.payload
      onPromptVariablesChange?.([
        ...promptVariables,
        {
          key: payload.variable as string,
          name: payload.label as string,
          enabled: payload.enabled,
          type: payload.type as string,
          config: payload.config,
          required: true,
          icon: payload.icon,
          icon_background: payload.icon_background,
        },
      ])
    }
  })

  const [
    isShowDeleteContextVarModal,
    { setTrue: showDeleteContextVarModal, setFalse: hideDeleteContextVarModal },
  ] = useBoolean(false)
  const [removeIndex, setRemoveIndex] = useState<number | null>(null)
  const didRemoveVar = useCallback(
    (index: number) => {
      onPromptVariablesChange?.(promptVariables.filter((_, i) => i !== index))
    },
    [onPromptVariablesChange, promptVariables],
  )

  const handleRemoveVar = useCallback(
    (index: number) => {
      const removeVar = promptVariables[index]

      if (mode === 'completion' && dataSets.length > 0 && removeVar!.is_context_var) {
        showDeleteContextVarModal()
        setRemoveIndex(index)
        return
      }
      didRemoveVar(index)
    },
    [dataSets.length, didRemoveVar, mode, promptVariables, showDeleteContextVarModal],
  )

  const [isShowEditModal, { setTrue: showEditModal, setFalse: hideEditModal }] = useBoolean(false)

  const handleConfig = useCallback(
    (item: PromptVariable, index: number) => {
      if (!BASIC_INPUT_TYPES.has(item.type)) {
        toolDialog.openWithPayload(item)
        return
      }

      setCurrIndex(index)
      showEditModal()
    },
    [toolDialog, showEditModal],
  )

  const {
    items: variables,
    getHandleProps,
    getItemKey,
    isSorting,
    announcement,
  } = useKeyboardSortable({
    items: promptVariables,
    onChange: (items) => onPromptVariablesChange?.(items),
    disabled: readonly,
    getItemLabel: (item) => item.name || item.key,
  })

  const promptVariablesWithIds = useMemo(
    () =>
      variables.map((item) => {
        return {
          id: item.key,
          variable: { ...item },
        }
      }),
    [variables],
  )
  const handlePromptVariablesReorder = useCallback(
    (list: typeof promptVariablesWithIds) => {
      const hasOrderChanged =
        list.length !== promptVariables.length ||
        list.some((item, index) => item.id !== promptVariables[index]?.key)
      if (isSorting || !hasOrderChanged) return

      onPromptVariablesChange?.(list.map((item) => item.variable))
    },
    [isSorting, onPromptVariablesChange, promptVariables],
  )

  const canDrag = !readonly && promptVariables.length > 1

  return (
    <>
      <Panel
        className="mt-2"
        title={
          <div className="flex items-center">
            <h2 id={titleId} className="me-1">
              {t(($) => $.variableTitle, { ns: 'appDebug' })}
            </h2>
            {!readonly && (
              <Infotip>
                <InfotipTrigger aria-labelledby={titleId} />
                <InfotipContent aria-labelledby={titleId} className="w-45">
                  {t(($) => $.variableTip, { ns: 'appDebug' })}
                </InfotipContent>
              </Infotip>
            )}
          </div>
        }
        headerRight={!readonly ? <SelectVarType onChange={handleAddVar} /> : null}
        noBodySpacing
      >
        {announcement}
        {!hasVar && (
          <div className="mt-1 px-3 pb-3">
            <div className="pt-2 pb-1 text-xs text-text-tertiary">
              {t(($) => $.notSetVar, { ns: 'appDebug', input: '{{input}}' })}
            </div>
          </div>
        )}
        {hasVar && (
          <div className={cn('mt-1 grid px-3 pb-3')}>
            <ReactSortable
              className={cn('grid space-y-1', readonly && 'grid-cols-2 gap-1 space-y-0')}
              list={promptVariablesWithIds}
              setList={handlePromptVariablesReorder}
              disabled={readonly || isSorting}
              handle=".handle"
              ghostClass="opacity-50"
              animation={150}
            >
              {promptVariablesWithIds.map((item, index) => {
                const { key, name, type, required } = item.variable
                return (
                  <VarItem
                    key={key}
                    dragHandleProps={getHandleProps(index)}
                    readonly={readonly}
                    name={key}
                    label={name}
                    required={!!required}
                    type={type}
                    onEdit={() => handleConfig(item.variable, getItemKey(index))}
                    onRemove={() => handleRemoveVar(getItemKey(index))}
                    canDrag={canDrag}
                  />
                )
              })}
            </ReactSortable>
          </div>
        )}

        {isShowEditModal && (
          <EditModal
            payload={currItemToEdit!}
            isShow={isShowEditModal}
            onClose={hideEditModal}
            onConfirm={(item) => {
              const isValid = updatePromptVariableItem(item)
              if (!isValid) return
              hideEditModal()
            }}
            varKeys={promptVariables.map((v) => v.key)}
          />
        )}

        <AlertDialog
          open={isShowDeleteContextVarModal}
          onOpenChange={(open) => !open && hideDeleteContextVarModal()}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(($) => $['feature.dataSet.queryVariable.deleteContextVarTitle'], {
                  ns: 'appDebug',
                  varName: promptVariables[removeIndex as number]?.name ?? '',
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(($) => $['feature.dataSet.queryVariable.deleteContextVarTip'], {
                  ns: 'appDebug',
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                onClick={() => {
                  didRemoveVar(removeIndex as number)
                  hideDeleteContextVarModal()
                }}
              >
                {t(($) => $['operation.confirm'], { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Panel>
      <Dialog handle={toolDialog} disablePointerDismissal>
        {({ payload: variable }) => (
          <ExternalDataToolDialogContent
            data={
              variable
                ? {
                    type: variable.type,
                    variable: variable.key,
                    label: variable.name,
                    config: variable.config,
                    icon: variable.icon,
                    icon_background: variable.icon_background,
                    enabled: variable.enabled,
                  }
                : undefined
            }
            isVariableUsed={(name) =>
              name !== variable?.key && promptVariables.some((item) => item.key === name)
            }
            onSave={(tool) => {
              const updated = {
                key: tool.variable,
                name: tool.label,
                enabled: tool.enabled,
                type: tool.type,
                config: tool.config,
                icon: tool.icon,
                icon_background: tool.icon_background,
              }
              onPromptVariablesChange?.(
                variable
                  ? promptVariables.map((item) =>
                      item.key === variable.key ? { ...item, ...updated } : item,
                    )
                  : [...promptVariables, { ...updated, required: true }],
              )
              toolDialog.close()
            }}
          />
        )}
      </Dialog>
    </>
  )
}
export default React.memo(ConfigVar)
