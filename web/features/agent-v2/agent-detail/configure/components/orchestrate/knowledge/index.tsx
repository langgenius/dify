'use client'

import type { TFunction } from 'i18next'
import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import { useAtomValue, useSetAtom } from 'jotai'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  agentComposerKnowledgeRetrievalsAtom,
  removeKnowledgeRetrievalAtom,
} from '@/features/agent-v2/agent-composer/store-modules/knowledge'
import { agentKnowledgeFsEnabledAtom } from '@/features/system-features/state'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionConfigurableItem } from '../common/configurable-item'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { AgentKnowledgeRetrievalDialog } from './dialog'

function KnowledgeRetrievalIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-subtle bg-util-colors-green-green-500 p-0.75 text-text-primary-on-surface shadow-xs shadow-shadow-shadow-3">
      <span aria-hidden className="i-ri-book-open-line size-3.5" />
    </span>
  )
}

function getKnowledgeRetrievalName(item: AgentKnowledgeRetrievalItem, t: TFunction<'agentV2'>) {
  const nameKey = item.nameKey
  return item.name ?? (nameKey ? t(($) => $[nameKey]) : item.id)
}

function AgentKnowledgeRetrievalRow({
  onDelete,
  onEdit,
  item,
}: {
  onDelete: () => void
  onEdit: () => void
  item: AgentKnowledgeRetrievalItem
}) {
  const { t } = useTranslation('agentV2')
  const itemName = getKnowledgeRetrievalName(item, t)

  return (
    <ConfigureSectionConfigurableItem
      icon={<KnowledgeRetrievalIcon />}
      label={itemName}
      editAriaLabel={t(($) => $['agentDetail.configure.knowledgeRetrieval.edit'], {
        name: itemName,
      })}
      removeAriaLabel={t(($) => $['agentDetail.configure.knowledgeRetrieval.remove'], {
        name: itemName,
      })}
      onEdit={onEdit}
      onRemove={onDelete}
    />
  )
}

export function AgentKnowledgeRetrieval() {
  const { t } = useTranslation('agentV2')
  const retrievals = useAtomValue(agentComposerKnowledgeRetrievalsAtom)
  const enabled = useAtomValue(agentKnowledgeFsEnabledAtom)
  const readOnly = useAgentOrchestrateReadOnly()
  const setRetrievals = useSetAtom(agentComposerKnowledgeRetrievalsAtom)
  const removeKnowledgeRetrieval = useSetAtom(removeKnowledgeRetrievalAtom)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const addOptionsRef = useRef<AgentOrchestrateAddActionOptions | undefined>(undefined)
  const knowledgeRetrievalTip = t(($) => $['agentDetail.configure.knowledgeFs.description'])
  const retrievalListId = useId()
  const addRetrieval = (options?: AgentOrchestrateAddActionOptions) => {
    if (!enabled || readOnly) return
    addOptionsRef.current = options
    setIsDialogOpen(true)
  }
  const confirmBindings = (next: AgentKnowledgeRetrievalItem[]) => {
    setRetrievals(next)
    setIsDialogOpen(false)
    const added = next.find((item) => !retrievals.some((previous) => previous.id === item.id))
    if (added) addOptionsRef.current?.onAdded?.(added)
    addOptionsRef.current = undefined
  }
  useRegisterAgentOrchestrateAddAction('knowledge', addRetrieval)

  return (
    <>
      <ConfigureSection
        label={t(($) => $['agentDetail.configure.knowledgeFs.title'])}
        labelId={`${retrievalListId}-label`}
        panelId={retrievalListId}
        tip={knowledgeRetrievalTip}
        tipAriaLabel={knowledgeRetrievalTip}
        rootClassName="border-b border-divider-subtle pt-4"
        panelContentClassName="flex flex-col gap-1 pb-4"
        actions={
          <ConfigureSectionAddButton
            ariaLabel={t(($) => $['agentDetail.configure.knowledgeFs.add'])}
            onClick={() => addRetrieval()}
            disabled={!enabled || readOnly}
          />
        }
      >
        {!enabled && (
          <p role="status" className="text-sm text-text-warning">
            {t(($) => $['agentDetail.configure.knowledgeFs.runtimeUnavailable'])}
          </p>
        )}
        {retrievals.length === 0 ? (
          <ConfigureSectionEmpty
            title={t(($) => $['agentDetail.configure.knowledgeRetrieval.empty.title'])}
            description={knowledgeRetrievalTip}
          />
        ) : (
          retrievals.map((item) => (
            <AgentKnowledgeRetrievalRow
              key={item.id}
              item={item}
              onDelete={() => removeKnowledgeRetrieval(item.id)}
              onEdit={() => {
                if (!readOnly) setIsDialogOpen(true)
              }}
            />
          ))
        )}
      </ConfigureSection>
      {isDialogOpen && (
        <AgentKnowledgeRetrievalDialog
          initialBindings={retrievals}
          onConfirm={confirmBindings}
          onClose={() => {
            setIsDialogOpen(false)
            addOptionsRef.current = undefined
          }}
        />
      )}
    </>
  )
}
