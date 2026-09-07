import type { ConversationVariable } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '@/app/components/workflow/block-icon'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import RemoveEffectVarConfirm from '@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm'
import {
  findUsedVarNodes,
  updateNodeVars,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import VariableItem from '@/app/components/workflow/panel/chat-variable-panel/components/variable-item'
import VariableModalTrigger from '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal-trigger'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { updateConversationVariables } from '@/service/workflow'
import { useCollaborativeWorkflow } from '../../hooks/use-collaborative-workflow'
import useInspectVarsCrud from '../../hooks/use-inspect-vars-crud'

const ChatVariablePanel = () => {
  const { t } = useTranslation()
  const setShowChatVariablePanel = useStore((s) => s.setShowChatVariablePanel)
  const varList = useStore((s) => s.conversationVariables) as ConversationVariable[]
  const updateChatVarList = useStore((s) => s.setConversationVariables)
  const setControlPromptEditorRerenderKey = useStore((s) => s.setControlPromptEditorRerenderKey)
  const appId = useStore((s) => s.appId) as string
  const { invalidateConversationVarValues } = useInspectVarsCrud()

  const [showTip, setShowTip] = useState(true)
  const [showVariableModal, setShowVariableModal] = useState(false)
  const [currentVar, setCurrentVar] = useState<ConversationVariable>()

  const [showRemoveVarConfirm, setShowRemoveConfirm] = useState(false)
  const [cacheForDelete, setCacheForDelete] = useState<ConversationVariable>()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  const getEffectedNodes = useCallback(
    (chatVar: ConversationVariable) => {
      const { nodes: allNodes } = collaborativeWorkflow.getState()
      return findUsedVarNodes(['conversation', chatVar.name], allNodes)
    },
    [collaborativeWorkflow],
  )

  const removeUsedVarInNodes = useCallback(
    (chatVar: ConversationVariable) => {
      const { nodes, setNodes } = collaborativeWorkflow.getState()
      const effectedNodes = getEffectedNodes(chatVar)
      const newNodes = nodes.map((node) => {
        if (effectedNodes.find((n) => n.id === node.id))
          return updateNodeVars(node, ['conversation', chatVar.name], [])

        return node
      })
      setNodes(newNodes)
    },
    [getEffectedNodes, collaborativeWorkflow],
  )

  const handleEdit = (chatVar: ConversationVariable) => {
    setCurrentVar(chatVar)
    setShowVariableModal(true)
  }

  const handleDelete = useCallback(
    async (chatVar: ConversationVariable) => {
      removeUsedVarInNodes(chatVar)
      const newVarList = varList.filter((v) => v.id !== chatVar.id)
      updateChatVarList(newVarList)
      setCacheForDelete(undefined)
      setShowRemoveConfirm(false)

      // Use new dedicated conversation variables API instead of workflow draft sync
      try {
        await updateConversationVariables({
          appId,
          conversationVariables: newVarList,
        })

        // Emit update event to other connected clients
        const socket = webSocketClient.getSocket(appId)
        if (socket) {
          socket.emit('collaboration_event', {
            type: 'vars_and_features_update',
          })
        }

        invalidateConversationVarValues()
      } catch (error) {
        console.error('Failed to update conversation variables:', error)
        // Revert local state on error
        updateChatVarList(varList)
      }
    },
    [removeUsedVarInNodes, updateChatVarList, varList, appId, invalidateConversationVarValues],
  )

  const deleteCheck = useCallback(
    (chatVar: ConversationVariable) => {
      const effectedNodes = getEffectedNodes(chatVar)
      if (effectedNodes.length > 0) {
        setCacheForDelete(chatVar)
        setShowRemoveConfirm(true)
      } else {
        handleDelete(chatVar)
      }
    },
    [getEffectedNodes, handleDelete],
  )

  const handleSave = useCallback(
    async (chatVar: ConversationVariable) => {
      let newList: ConversationVariable[]

      if (!currentVar) {
        // Adding new conversation variable
        newList = [chatVar, ...varList]
        updateChatVarList(newList)

        // Use new dedicated conversation variables API
        try {
          await updateConversationVariables({
            appId,
            conversationVariables: newList,
          })

          const socket = webSocketClient.getSocket(appId)
          if (socket) {
            socket.emit('collaboration_event', {
              type: 'vars_and_features_update',
            })
          }

          invalidateConversationVarValues()
        } catch (error) {
          console.error('Failed to update conversation variables:', error)
          // Revert local state on error
          updateChatVarList(varList)
        }
        return
      }

      // Updating existing conversation variable
      newList = varList.map((v) => (v.id === currentVar.id ? chatVar : v))
      updateChatVarList(newList)

      // side effects of rename conversation variable
      if (currentVar.name !== chatVar.name) {
        const { nodes, setNodes } = collaborativeWorkflow.getState()
        const effectedNodes = getEffectedNodes(currentVar)
        const newNodes = nodes.map((node) => {
          if (effectedNodes.find((n) => n.id === node.id))
            return updateNodeVars(
              node,
              ['conversation', currentVar.name],
              ['conversation', chatVar.name],
            )

          return node
        })
        setNodes(newNodes)
        setControlPromptEditorRerenderKey(Date.now())
      }

      // Use new dedicated conversation variables API
      try {
        await updateConversationVariables({
          appId,
          conversationVariables: newList,
        })

        const socket = webSocketClient.getSocket(appId)
        if (socket) {
          socket.emit('collaboration_event', {
            type: 'vars_and_features_update',
          })
        }

        invalidateConversationVarValues()
      } catch (error) {
        console.error('Failed to update conversation variables:', error)
        // Revert local state on error
        updateChatVarList(varList)
      }
    },
    [
      currentVar,
      getEffectedNodes,
      collaborativeWorkflow,
      updateChatVarList,
      varList,
      appId,
      invalidateConversationVarValues,
      setControlPromptEditorRerenderKey,
    ],
  )

  return (
    <Collapsible
      open={showTip}
      onOpenChange={setShowTip}
      render={
        <div
          className={cn(
            'relative flex h-full w-105 flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt',
          )}
        />
      }
    >
      <div className="flex shrink-0 items-center justify-between p-4 pb-0 system-xl-semibold text-text-primary">
        {t(($) => $['chatVariable.panelTitle'], { ns: 'workflow' })}
        <div className="flex items-center gap-1">
          <CollapsibleTrigger
            className="size-6 min-h-0 justify-center gap-0 p-0.5 hover:not-data-disabled:text-text-secondary data-panel-open:bg-state-accent-active data-panel-open:text-text-accent data-panel-open:hover:bg-state-accent-active-alt"
            render={
              <IconButton aria-label={t(($) => $['chatVariable.tips'], { ns: 'workflow' })}>
                <span aria-hidden="true" className="i-ri-book-open-line size-4" />
              </IconButton>
            }
          />
          <IconButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            onClick={() => setShowChatVariablePanel(false)}
          >
            <span aria-hidden="true" className="i-ri-close-line size-4 text-text-tertiary" />
          </IconButton>
        </div>
      </div>
      <CollapsiblePanel render={<div className="shrink-0 px-3 pt-2.5 pb-2" />}>
        <div className="relative rounded-2xl bg-background-section-burn p-3">
          <div className="inline-block rounded-[5px] border border-divider-deep px-1.25 py-0.75 system-2xs-medium-uppercase text-text-tertiary">
            TIPS
          </div>
          <div className="mt-1 mb-4 system-sm-regular text-text-secondary">
            {t(($) => $['chatVariable.panelDescription'], { ns: 'workflow' })}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-col rounded-[10px] border border-workflow-block-border bg-workflow-block-bg p-3 pb-4 shadow-md">
              <span
                aria-hidden="true"
                className="mb-1 i-custom-vender-line-others-bubble-x size-4 shrink-0 text-util-colors-teal-teal-700"
              />
              <div className="system-xs-semibold text-text-secondary">conversation_var</div>
              <div className="system-2xs-regular text-text-tertiary">String</div>
            </div>
            <div className="grow">
              <div className="mb-2 flex items-center gap-2 py-1">
                <div className="flex h-3 w-16 shrink-0 items-center gap-1 px-1">
                  <span
                    aria-hidden="true"
                    className="i-custom-vender-line-others-long-arrow-left h-2 grow text-text-quaternary"
                  />
                  <div className="shrink-0 system-2xs-medium text-text-tertiary">WRITE</div>
                </div>
                <BlockIcon className="shrink-0" type={BlockEnum.Assigner} />
                <div className="grow truncate system-xs-semibold text-text-secondary">
                  {t(($) => $['blocks.assigner'], { ns: 'workflow' })}
                </div>
              </div>
              <div className="flex items-center gap-2 py-1">
                <div className="flex h-3 w-16 shrink-0 items-center gap-1 px-1">
                  <div className="shrink-0 system-2xs-medium text-text-tertiary">READ</div>
                  <span
                    aria-hidden="true"
                    className="i-custom-vender-line-others-long-arrow-right h-2 grow text-text-quaternary"
                  />
                </div>
                <BlockIcon className="shrink-0" type={BlockEnum.LLM} />
                <div className="grow truncate system-xs-semibold text-text-secondary">
                  {t(($) => $['blocks.llm'], { ns: 'workflow' })}
                </div>
              </div>
            </div>
          </div>
          <div className="absolute -top-1 right-9.5 z-10 h-3 w-3 rotate-45 bg-background-section-burn" />
        </div>
      </CollapsiblePanel>
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
        {varList.map((chatVar) => (
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
    </Collapsible>
  )
}

export default memo(ChatVariablePanel)
