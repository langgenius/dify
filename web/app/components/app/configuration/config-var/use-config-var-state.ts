import type { ExternalDataToolParams } from './helpers'
import type { InputVar } from '@/app/components/workflow/types'
import type { ExternalDataTool } from '@/models/common'
import type { PromptVariable } from '@/models/debug'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { useBoolean } from 'ahooks'
import { produce } from 'immer'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { toast } from '@/app/components/base/ui/toast'
import ConfigContext from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useModalContext } from '@/context/modal-context'
import { AppModeEnum } from '@/types/app'
import { getNewVar } from '@/utils/var'
import {
  ADD_EXTERNAL_DATA_TOOL,
  BASIC_INPUT_TYPES,
  buildPromptVariableFromExternalDataTool,
  buildPromptVariableFromInput,
  createPromptVariablesWithIds,

  getDuplicateError,
  toInputVar,
} from './helpers'

type ExternalDataToolEvent = {
  payload: ExternalDataTool
  type: string
}

type UseConfigVarStateParams = {
  promptVariables: PromptVariable[]
  readonly?: boolean
  onPromptVariablesChange?: (promptVariables: PromptVariable[]) => void
}

export const useConfigVarState = ({
  promptVariables,
  readonly,
  onPromptVariablesChange,
}: UseConfigVarStateParams) => {
  const { t } = useTranslation()
  const {
    mode,
    dataSets,
  } = useContext(ConfigContext)
  const { eventEmitter } = useEventEmitterContextContext()
  const { setShowExternalDataToolModal } = useModalContext()

  const hasVar = promptVariables.length > 0
  const [currIndex, setCurrIndex] = useState<number>(-1)
  const [removeIndex, setRemoveIndex] = useState<number | null>(null)
  const [isShowDeleteContextVarModal, { setTrue: showDeleteContextVarModal, setFalse: hideDeleteContextVarModal }] = useBoolean(false)
  const [isShowEditModal, { setTrue: showEditModal, setFalse: hideEditModal }] = useBoolean(false)

  const currItem = currIndex !== -1 ? promptVariables[currIndex] : null
  const currItemToEdit = useMemo(() => {
    if (!currItem)
      return null

    return toInputVar(currItem)
  }, [currItem])

  const openExternalDataToolModal = useCallback((
    { key, type, index, name, config, icon, icon_background }: ExternalDataToolParams,
    oldPromptVariables: PromptVariable[],
  ) => {
    setShowExternalDataToolModal({
      payload: {
        type,
        variable: key,
        label: name,
        config,
        icon,
        icon_background,
      },
      onSaveCallback: (newExternalDataTool?: ExternalDataTool) => {
        if (!newExternalDataTool)
          return

        const newPromptVariables = oldPromptVariables.map((item, itemIndex) => {
          if (itemIndex === index)
            return buildPromptVariableFromExternalDataTool(newExternalDataTool, item.required ?? false)

          return item
        })

        onPromptVariablesChange?.(newPromptVariables)
      },
      onCancelCallback: () => {
        if (!key)
          onPromptVariablesChange?.(promptVariables.filter((_, itemIndex) => itemIndex !== index))
      },
      onValidateBeforeSaveCallback: (newExternalDataTool: ExternalDataTool) => {
        for (let i = 0; i < promptVariables.length; i++) {
          if (promptVariables[i].key === newExternalDataTool.variable && i !== index) {
            toast.error(t('varKeyError.keyAlreadyExists', { ns: 'appDebug', key: promptVariables[i].key }))
            return false
          }
        }

        return true
      },
    })
  }, [onPromptVariablesChange, promptVariables, setShowExternalDataToolModal, t])

  const updatePromptVariableItem = useCallback((payload: InputVar) => {
    const newPromptVariables = produce(promptVariables, (draft) => {
      draft[currIndex] = buildPromptVariableFromInput(payload)
    })
    const duplicateError = getDuplicateError(newPromptVariables)
    if (duplicateError) {
      toast.error(t(duplicateError.errorMsgKey as I18nKeysByPrefix<'appDebug', 'duplicateError.'>, {
        ns: 'appDebug',
        key: t(duplicateError.typeName as I18nKeysByPrefix<'appDebug', 'duplicateError.'>, { ns: 'appDebug' }),
      }) as string)
      return false
    }

    onPromptVariablesChange?.(newPromptVariables)
    return true
  }, [currIndex, onPromptVariablesChange, promptVariables, t])

  const handleAddVar = useCallback((type: string) => {
    const newVar = getNewVar('', type)
    const newPromptVariables = [...promptVariables, newVar]
    onPromptVariablesChange?.(newPromptVariables)

    if (type === 'api') {
      openExternalDataToolModal({
        type,
        key: newVar.key,
        name: newVar.name,
        index: promptVariables.length,
      }, newPromptVariables)
    }
  }, [onPromptVariablesChange, openExternalDataToolModal, promptVariables])

  eventEmitter?.useSubscription((event) => {
    if (typeof event === 'string' || event.type !== ADD_EXTERNAL_DATA_TOOL || !event.payload)
      return

    onPromptVariablesChange?.([
      ...promptVariables,
      buildPromptVariableFromExternalDataTool(event.payload as ExternalDataToolEvent['payload'], true),
    ])
  })

  const didRemoveVar = useCallback((index: number) => {
    onPromptVariablesChange?.(promptVariables.filter((_, itemIndex) => itemIndex !== index))
  }, [onPromptVariablesChange, promptVariables])

  const handleRemoveVar = useCallback((index: number) => {
    const removeVar = promptVariables[index]

    if (mode === AppModeEnum.COMPLETION && dataSets.length > 0 && removeVar.is_context_var) {
      showDeleteContextVarModal()
      setRemoveIndex(index)
      return
    }

    didRemoveVar(index)
  }, [dataSets.length, didRemoveVar, mode, promptVariables, showDeleteContextVarModal])

  const handleConfig = useCallback((params: ExternalDataToolParams) => {
    setCurrIndex(params.index)
    if (!BASIC_INPUT_TYPES.has(params.type)) {
      openExternalDataToolModal(params, promptVariables)
      return
    }

    showEditModal()
  }, [openExternalDataToolModal, promptVariables, showEditModal])

  const handleSort = useCallback((list: ReturnType<typeof createPromptVariablesWithIds>) => {
    onPromptVariablesChange?.(list.map(item => item.variable))
  }, [onPromptVariablesChange])

  const handleEditConfirm = useCallback((item: InputVar) => {
    const isValid = updatePromptVariableItem(item)
    if (!isValid)
      return false

    hideEditModal()
    return true
  }, [hideEditModal, updatePromptVariableItem])

  const handleDeleteContextVarConfirm = useCallback(() => {
    didRemoveVar(removeIndex as number)
    hideDeleteContextVarModal()
  }, [didRemoveVar, hideDeleteContextVarModal, removeIndex])

  const promptVariablesWithIds = useMemo(() => createPromptVariablesWithIds(promptVariables), [promptVariables])
  const canDrag = !readonly && promptVariables.length > 1

  return {
    canDrag,
    currItemToEdit,
    handleAddVar,
    handleConfig,
    handleDeleteContextVarConfirm,
    handleRemoveVar,
    handleSort,
    handleEditConfirm,
    hasVar,
    hideDeleteContextVarModal,
    hideEditModal,
    isShowDeleteContextVarModal,
    isShowEditModal,
    promptVariablesWithIds,
    removeIndex,
  }
}
