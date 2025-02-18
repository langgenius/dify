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
        'bg-components-panel-bg-alt border-components-panel-border relative flex h-full w-[420px] flex-col rounded-l-2xl border',
      )}
    >
      <div className='text-text-primary system-xl-semibold flex shrink-0 items-center justify-between p-4 pb-0'>
        {t('workflow.chatVariable.panelTitle')}
        <div className='flex items-center gap-1'>
          <ActionButton state={showTip ? ActionButtonState.Active : undefined} onClick={() => setShowTip(!showTip)}>
            <RiBookOpenLine className='h-4 w-4' />
          </ActionButton>
          <div
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
            onClick={() => setShowChatVariablePanel(false)}
          >
            <RiCloseLine className='text-text-tertiary h-4 w-4' />
          </div>
        </div>
      </div>
      {showTip && (
        <div className='shrink-0 px-3 pb-2 pt-2.5'>
          <div className='radius-2xl bg-background-section-burn relative p-3'>
            <div className='border-divider-deep text-text-tertiary system-2xs-medium-uppercase inline-block rounded-[5px] border px-[5px] py-[3px]'>TIPS</div>
            <div className='system-sm-regular text-text-secondary mb-4 mt-1'>
              {t('workflow.chatVariable.panelDescription')}
              <a target='_blank' rel='noopener noreferrer' className='text-text-accent' href={locale !== LanguagesSupported[1] ? 'https://docs.dify.ai/guides/workflow/variables#conversation-variables' : `https://docs.dify.ai/${locale.toLowerCase()}/guides/workflow/variables#hui-hua-bian-liang`}>{t('workflow.chatVariable.docLink')}</a>
            </div>
            <div className='flex items-center gap-2'>
              <div className='bg-workflow-block-bg radius-lg border-workflow-block-border flex flex-col border p-3 pb-4 shadow-md'>
                <BubbleX className='text-util-colors-teal-teal-700 mb-1 h-4 w-4 shrink-0' />
                <div className='text-text-secondary system-xs-semibold'>conversation_var</div>
                <div className='text-text-tertiary system-2xs-regular'>String</div>
              </div>
              <div className='grow'>
                <div className='mb-2 flex items-center gap-2 py-1'>
                  <div className='flex h-3 w-16 shrink-0 items-center gap-1 px-1'>
                    <LongArrowLeft className='text-text-quaternary h-2 grow' />
                    <div className='text-text-tertiary system-2xs-medium shrink-0'>WRITE</div>
                  </div>
                  <BlockIcon className='shrink-0' type={BlockEnum.Assigner} />
                  <div className='text-text-secondary system-xs-semibold grow truncate'>{t('workflow.blocks.assigner')}</div>
                </div>
                <div className='flex items-center gap-2 py-1'>
                  <div className='flex h-3 w-16 shrink-0 items-center gap-1 px-1'>
                    <div className='text-text-tertiary system-2xs-medium shrink-0'>READ</div>
                    <LongArrowRight className='text-text-quaternary h-2 grow' />
                  </div>
                  <BlockIcon className='shrink-0' type={BlockEnum.LLM} />
                  <div className='text-text-secondary system-xs-semibold grow truncate'>{t('workflow.blocks.llm')}</div>
                </div>
              </div>
            </div>
            <div className='bg-background-section-burn absolute right-[38px] top-[-4px] z-10 h-3 w-3 rotate-45'/>
          </div>
        </div>
      )}
      <div className='shrink-0 px-4 pb-3 pt-2'>
        <VariableModalTrigger
          open={showVariableModal}
          setOpen={setShowVariableModal}
          showTip={showTip}
          chatVar={currentVar}
          onSave={handleSave}
          onClose={() => setCurrentVar(undefined)}
        />
      </div>
      <div className='grow overflow-y-auto rounded-b-2xl px-4'>
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
