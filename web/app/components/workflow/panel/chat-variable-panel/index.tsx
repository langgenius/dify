import type {
  ConversationVariable,
} from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiBookOpenLine, RiCloseLine } from '@remixicon/react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useStoreApi,
} from 'reactflow'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import { BubbleX, LongArrowLeft, LongArrowRight } from '@/app/components/base/icons/src/vender/line/others'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import RemoveEffectVarConfirm from '@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm'
import { findUsedVarNodes, updateNodeVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import VariableItem from '@/app/components/workflow/panel/chat-variable-panel/components/variable-item'
import VariableModalTrigger from '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal-trigger'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import useInspectVarsCrud from '../../hooks/use-inspect-vars-crud'

const ChatVariablePanel = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const setShowChatVariablePanel = useStore(s => s.setShowChatVariablePanel)
  const varList = useStore(s => s.conversationVariables) as ConversationVariable[]
  const updateChatVarList = useStore(s => s.setConversationVariables)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const {
    invalidateConversationVarValues,
  } = useInspectVarsCrud()
  const handleVarChanged = useCallback(() => {
    doSyncWorkflowDraft(false, {
      onSuccess() {
        invalidateConversationVarValues()
      },
    })
  }, [doSyncWorkflowDraft, invalidateConversationVarValues])

  const [showTip, setShowTip] = useState(true)
  const [showVariableModal, setShowVariableModal] = useState(false)
  const [currentVar, setCurrentVar] = useState<ConversationVariable>()

  const [showRemoveVarConfirm, setShowRemoveConfirm] = useState(false)
  const [cacheForDelete, setCacheForDelete] = useState<ConversationVariable>()

  const getEffectedNodes = useCallback((chatVar: ConversationVariable) => {
    const { getNodes } = store.getState()
    const allNodes = getNodes()
    return findUsedVarNodes(
      ['conversation', chatVar.name],
      allNodes,
    )
  }, [store])

  const removeUsedVarInNodes = useCallback((chatVar: ConversationVariable) => {
    const { getNodes, setNodes } = store.getState()
    const effectedNodes = getEffectedNodes(chatVar)
    const newNodes = getNodes().map((node) => {
      if (effectedNodes.find(n => n.id === node.id))
        return updateNodeVars(node, ['conversation', chatVar.name], [])

      return node
    })
    setNodes(newNodes)
  }, [getEffectedNodes, store])

  const handleEdit = (chatVar: ConversationVariable) => {
    setCurrentVar(chatVar)
    setShowVariableModal(true)
  }

  const handleDelete = useCallback((chatVar: ConversationVariable) => {
    removeUsedVarInNodes(chatVar)
    updateChatVarList(varList.filter(v => v.id !== chatVar.id))
    setCacheForDelete(undefined)
    setShowRemoveConfirm(false)
    handleVarChanged()
  }, [handleVarChanged, removeUsedVarInNodes, updateChatVarList, varList])

  const deleteCheck = useCallback((chatVar: ConversationVariable) => {
    const effectedNodes = getEffectedNodes(chatVar)
    if (effectedNodes.length > 0) {
      setCacheForDelete(chatVar)
      setShowRemoveConfirm(true)
    }
    else {
      handleDelete(chatVar)
    }
  }, [getEffectedNodes, handleDelete])

  const handleSave = useCallback(async (chatVar: ConversationVariable) => {
    // add chatVar
    if (!currentVar) {
      const newList = [chatVar, ...varList]
      updateChatVarList(newList)
      handleVarChanged()
      return
    }
    // edit chatVar
    const newList = varList.map(v => v.id === currentVar.id ? chatVar : v)
    updateChatVarList(newList)
    // side effects of rename env
    if (currentVar.name !== chatVar.name) {
      const { getNodes, setNodes } = store.getState()
      const effectedNodes = getEffectedNodes(currentVar)
      const newNodes = getNodes().map((node) => {
        if (effectedNodes.find(n => n.id === node.id))
          return updateNodeVars(node, ['conversation', currentVar.name], ['conversation', chatVar.name])

        return node
      })
      setNodes(newNodes)
    }
    handleVarChanged()
  }, [currentVar, getEffectedNodes, handleVarChanged, store, updateChatVarList, varList])

  return (
    <div
      className={cn(
        'relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt',
      )}
    >
      <div className="flex shrink-0 items-center justify-between p-4 pb-0 system-xl-semibold text-text-primary">
        {t('chatVariable.panelTitle', { ns: 'workflow' })}
        <div className="flex items-center gap-1">
          <ActionButton state={showTip ? ActionButtonState.Active : undefined} onClick={() => setShowTip(!showTip)}>
            <RiBookOpenLine className="h-4 w-4" />
          </ActionButton>
          <div
            className="flex h-6 w-6 cursor-pointer items-center justify-center"
            onClick={() => setShowChatVariablePanel(false)}
          >
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
      </div>
      {showTip && (
        <div className="shrink-0 px-3 pt-2.5 pb-2">
          <div className="relative rounded-2xl bg-background-section-burn p-3">
            <div className="inline-block rounded-[5px] border border-divider-deep px-[5px] py-[3px] system-2xs-medium-uppercase text-text-tertiary">TIPS</div>
            <div className="mt-1 mb-4 system-sm-regular text-text-secondary">
              {t('chatVariable.panelDescription', { ns: 'workflow' })}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-col rounded-[10px] border border-workflow-block-border bg-workflow-block-bg p-3 pb-4 shadow-md">
                <BubbleX className="mb-1 h-4 w-4 shrink-0 text-util-colors-teal-teal-700" />
                <div className="system-xs-semibold text-text-secondary">conversation_var</div>
                <div className="system-2xs-regular text-text-tertiary">String</div>
              </div>
              <div className="grow">
                <div className="mb-2 flex items-center gap-2 py-1">
                  <div className="flex h-3 w-16 shrink-0 items-center gap-1 px-1">
                    <LongArrowLeft className="h-2 grow text-text-quaternary" />
                    <div className="shrink-0 system-2xs-medium text-text-tertiary">WRITE</div>
                  </div>
                  <BlockIcon className="shrink-0" type={BlockEnum.Assigner} />
                  <div className="grow truncate system-xs-semibold text-text-secondary">{t('blocks.assigner', { ns: 'workflow' })}</div>
                </div>
                <div className="flex items-center gap-2 py-1">
                  <div className="flex h-3 w-16 shrink-0 items-center gap-1 px-1">
                    <div className="shrink-0 system-2xs-medium text-text-tertiary">READ</div>
                    <LongArrowRight className="h-2 grow text-text-quaternary" />
                  </div>
                  <BlockIcon className="shrink-0" type={BlockEnum.LLM} />
                  <div className="grow truncate system-xs-semibold text-text-secondary">{t('blocks.llm', { ns: 'workflow' })}</div>
                </div>
              </div>
            </div>
            <div className="absolute top-[-4px] right-[38px] z-10 h-3 w-3 rotate-45 bg-background-section-burn" />
          </div>
        </div>
      )}
      <div className="shrink-0 px-4 pt-2 pb-3">
        <VariableModalTrigger
          open={showVariableModal}
          setOpen={setShowVariableModal}
          showTip={showTip}
          chatVar={currentVar}
          onSave={handleSave}
          onClose={() => setCurrentVar(undefined)}
        />
      </div>
      <div className="grow overflow-y-auto rounded-b-2xl px-4">
        {varList.map(chatVar => (
          <VariableItem
            key={chatVar.id}
            item={chatVar}
            onEdit={handleEdit}
            onDelete={deleteCheck}
          />
        ))}
      </div>
      <RemoveEffectVarConfirm
        isShow={showRemoveVarConfirm}
        onCancel={() => setShowRemoveConfirm(false)}
        onConfirm={() => cacheForDelete && handleDelete(cacheForDelete)}
      />
    </div>
  )
}

export default memo(ChatVariablePanel)
