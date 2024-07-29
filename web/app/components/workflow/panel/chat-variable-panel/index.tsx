import {
  memo,
  useCallback,
  useState,
} from 'react'
import {
  useStoreApi,
} from 'reactflow'
import { RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import VariableModalTrigger from '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal-trigger'
import VariableItem from '@/app/components/workflow/panel/chat-variable-panel/components/variable-item'
import RemoveEffectVarConfirm from '@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm'
import type {
  ConversationVariable,
} from '@/app/components/workflow/types'
import { findUsedVarNodes, updateNodeVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import cn from '@/utils/classnames'

const ChatVariablePanel = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const setShowChatVariablePanel = useStore(s => s.setShowChatVariablePanel)
  const varList = useStore(s => s.conversationVariables) as ConversationVariable[]
  const updateChatVarList = useStore(s => s.setConversationVariables)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

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
    doSyncWorkflowDraft()
  }, [doSyncWorkflowDraft, removeUsedVarInNodes, updateChatVarList, varList])

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
      doSyncWorkflowDraft()
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
    doSyncWorkflowDraft()
  }, [currentVar, doSyncWorkflowDraft, getEffectedNodes, store, updateChatVarList, varList])

  return (
    <div
      className={cn(
        'relative flex flex-col w-[420px] bg-components-panel-bg-alt rounded-l-2xl h-full border border-components-panel-border',
      )}
    >
      <div className='shrink-0 flex items-center justify-between p-4 pb-0 text-text-primary system-xl-semibold'>
        {t('workflow.chatVariable.panelTitle')}
        <div className='flex items-center'>
          <div
            className='flex items-center justify-center w-6 h-6 cursor-pointer'
            onClick={() => setShowChatVariablePanel(false)}
          >
            <RiCloseLine className='w-4 h-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className='shrink-0 py-1 px-4 system-sm-regular text-text-tertiary'>{t('workflow.chatVariable.panelDescription')}</div>
      <div className='shrink-0 px-4 pt-2 pb-3'>
        <VariableModalTrigger
          open={showVariableModal}
          setOpen={setShowVariableModal}
          chatVar={currentVar}
          onSave={handleSave}
          onClose={() => setCurrentVar(undefined)}
        />
      </div>
      <div className='grow px-4 rounded-b-2xl overflow-y-auto'>
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
