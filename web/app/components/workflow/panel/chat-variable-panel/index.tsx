import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useContext } from 'use-context-selector'
import {
  useStoreApi,
} from 'reactflow'
import { RiBookOpenLine, RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import { BubbleX, LongArrowLeft, LongArrowRight } from '@/app/components/base/icons/src/vender/line/others'
import BlockIcon from '@/app/components/workflow/block-icon'
import VariableModalTrigger from '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal-trigger'
import VariableItem from '@/app/components/workflow/panel/chat-variable-panel/components/variable-item'
import RemoveEffectVarConfirm from '@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm'
import type {
  ConversationVariable,
} from '@/app/components/workflow/types'
import { findUsedVarNodes, updateNodeVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { BlockEnum } from '@/app/components/workflow/types'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'
import cn from '@/utils/classnames'

const ChatVariablePanel = () => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const store = useStoreApi()
  const setShowChatVariablePanel = useStore(s => s.setShowChatVariablePanel)
  const varList = useStore(s => s.conversationVariables) as ConversationVariable[]
  const updateChatVarList = useStore(s => s.setConversationVariables)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

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
        <div className='flex items-center gap-1'>
          <ActionButton state={showTip ? ActionButtonState.Active : undefined} onClick={() => setShowTip(!showTip)}>
            <RiBookOpenLine className='w-4 h-4' />
          </ActionButton>
          <div
            className='flex items-center justify-center w-6 h-6 cursor-pointer'
            onClick={() => setShowChatVariablePanel(false)}
          >
            <RiCloseLine className='w-4 h-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      {showTip && (
        <div className='shrink-0 px-3 pt-2.5 pb-2'>
          <div className='relative p-3 radius-2xl bg-background-section-burn'>
            <div className='inline-block py-[3px] px-[5px] rounded-[5px] border border-divider-deep text-text-tertiary system-2xs-medium-uppercase'>TIPS</div>
            <div className='mt-1 mb-4 system-sm-regular text-text-secondary'>
              {t('workflow.chatVariable.panelDescription')}
              <a target='_blank' rel='noopener noreferrer' className='text-text-accent' href={locale !== LanguagesSupported[1] ? 'https://docs.dify.ai/guides/workflow/key_concepts#conversation-variables' : `https://docs.dify.ai/v/${locale.toLowerCase()}/guides/workflow/key_concept#hui-hua-bian-liang`}>{t('workflow.chatVariable.docLink')}</a>
            </div>
            <div className='flex items-center gap-2'>
              <div className='flex flex-col p-3 pb-4 bg-workflow-block-bg radius-lg border border-workflow-block-border shadow-md'>
                <BubbleX className='shrink-0 mb-1 w-4 h-4 text-util-colors-teal-teal-700' />
                <div className='text-text-secondary system-xs-semibold'>conversation_var</div>
                <div className='text-text-tertiary system-2xs-regular'>String</div>
              </div>
              <div className='grow'>
                <div className='mb-2 flex items-center gap-2 py-1'>
                  <div className='shrink-0 flex items-center gap-1 w-16 h-3 px-1'>
                    <LongArrowLeft className='grow h-2 text-text-quaternary' />
                    <div className='shrink-0 text-text-tertiary system-2xs-medium'>WRITE</div>
                  </div>
                  <BlockIcon className='shrink-0' type={BlockEnum.Assigner} />
                  <div className='grow text-text-secondary system-xs-semibold truncate'>{t('workflow.blocks.assigner')}</div>
                </div>
                <div className='flex items-center gap-2 py-1'>
                  <div className='shrink-0 flex items-center gap-1 w-16 h-3 px-1'>
                    <div className='shrink-0 text-text-tertiary system-2xs-medium'>READ</div>
                    <LongArrowRight className='grow h-2 text-text-quaternary' />
                  </div>
                  <BlockIcon className='shrink-0' type={BlockEnum.LLM} />
                  <div className='grow text-text-secondary system-xs-semibold truncate'>{t('workflow.blocks.llm')}</div>
                </div>
              </div>
            </div>
            <div className='absolute z-10 top-[-4px] right-[38px] w-3 h-3 bg-background-section-burn rotate-45'/>
          </div>
        </div>
      )}
      <div className='shrink-0 px-4 pt-2 pb-3'>
        <VariableModalTrigger
          open={showVariableModal}
          setOpen={setShowVariableModal}
          showTip={showTip}
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
