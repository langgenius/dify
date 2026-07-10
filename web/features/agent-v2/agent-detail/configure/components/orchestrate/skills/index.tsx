'use client'

import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  agentComposerSkillsAtom,
  removeAgentSkillAtom,
  upsertAgentSkillAtom,
} from '@/features/agent-v2/agent-composer/store-modules/skills'
import { consoleQuery } from '@/service/client'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { AgentConfigureTipContent } from '../common/tip-content'
import { useAgentConfigApiContext } from '../config-context'
import { AgentSkillItem } from './item'
import { AgentSkillUploadDialog } from './upload-dialog'

export function AgentSkills() {
  const { t } = useTranslation('agentV2')
  const skillsTip = t($ => $['agentDetail.configure.skills.tip'])
  const skillsListId = 'agent-configure-skills-list'
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const promptAddCallbackRef = useRef<AgentOrchestrateAddActionOptions['onAdded']>(undefined)
  const apiContext = useAgentConfigApiContext()
  const skills = useAtomValue(agentComposerSkillsAtom)
  const upsertAgentSkill = useSetAtom(upsertAgentSkillAtom)
  const removeAgentSkill = useSetAtom(removeAgentSkillAtom)
  const { mutate: deleteAgentSkill } = useMutation(consoleQuery.agent.byAgentId.config.skills.byName.delete.mutationOptions())
  const { mutate: deleteAppSkill } = useMutation(consoleQuery.apps.byAppId.agent.config.skills.byName.delete.mutationOptions())

  const handleOpenUpload = useCallback((options?: AgentOrchestrateAddActionOptions) => {
    promptAddCallbackRef.current = options?.onAdded
    setIsUploadOpen(true)
  }, [])
  useRegisterAgentOrchestrateAddAction('skills', handleOpenUpload)

  const handleUploaded = useCallback((skill: AgentSkill) => {
    upsertAgentSkill(skill)
    promptAddCallbackRef.current?.(skill)
    promptAddCallbackRef.current = undefined
  }, [upsertAgentSkill])

  const handleUploadOpenChange = useCallback((open: boolean) => {
    if (!open)
      promptAddCallbackRef.current = undefined
    setIsUploadOpen(open)
  }, [])

  const handleRemoveSkill = useCallback((skillId: string) => {
    const skill = skills.find(item => item.id === skillId)
    if (!skill)
      return

    const onSuccess = () => {
      removeAgentSkill(skillId)
    }
    if (apiContext.workflow) {
      deleteAppSkill({
        params: {
          app_id: apiContext.workflow.appId,
          name: skill.name,
        },
        query: {
          node_id: apiContext.workflow.nodeId,
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
      }, { onSuccess })
      return
    }

    deleteAgentSkill({
      params: {
        agent_id: apiContext.agentId,
        name: skill.name,
      },
      query: {
        draft_type: apiContext.draftType,
        version_id: apiContext.versionId,
      },
    }, { onSuccess })
  }, [apiContext, deleteAgentSkill, deleteAppSkill, removeAgentSkill, skills])

  return (
    <>
      <ConfigureSection
        label={t($ => $['agentDetail.configure.skills.label'])}
        labelId="agent-configure-skills-label"
        buildDraftChangeSection="skills"
        panelId={skillsListId}
        tip={<AgentConfigureTipContent type="skills" />}
        tipAriaLabel={skillsTip}
        rootClassName="border-b border-divider-subtle pt-4"
        panelContentClassName="flex flex-col gap-1 pb-4"
        actions={(
          <ConfigureSectionAddButton
            ariaLabel={t($ => $['agentDetail.configure.skills.add'])}
            onClick={() => handleOpenUpload()}
          />
        )}
      >
        {skills.length === 0
          ? (
              <ConfigureSectionEmpty
                title={t($ => $['agentDetail.configure.skills.empty.title'])}
                description={t($ => $['agentDetail.configure.skills.empty.description'])}
              />
            )
          : skills.map(skill => (
              <AgentSkillItem key={skill.id} apiContext={apiContext} skill={skill} onRemove={handleRemoveSkill} />
            ))}
      </ConfigureSection>
      <AgentSkillUploadDialog
        apiContext={apiContext}
        open={isUploadOpen}
        onOpenChange={handleUploadOpenChange}
        onUploaded={handleUploaded}
      />
    </>
  )
}
