'use client'

import type { AgentOrchestrateAddActionOptions } from '../add-actions-context'
import type { AgentSkill } from '@/features/agent-v2/agent-composer/form-state'
import { useAtom } from 'jotai'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentComposerSkillsAtom, useRemoveSkill } from '@/features/agent-v2/agent-composer/store-modules/skills'
import { useRegisterAgentOrchestrateAddAction } from '../add-actions-context'
import { ConfigureSectionAddButton } from '../common/add-button'
import { ConfigureSectionEmpty } from '../common/empty'
import { ConfigureSection } from '../common/section'
import { AgentSkillItem } from './item'
import { AgentSkillUploadDialog } from './upload-dialog'

export function AgentSkills({
  agentId,
}: {
  agentId: string
}) {
  const { t } = useTranslation('agentV2')
  const [skills, setSkills] = useAtom(agentComposerSkillsAtom)
  const removeSkill = useRemoveSkill()
  const skillsTip = t('agentDetail.configure.skills.tip')
  const skillsListId = 'agent-configure-skills-list'
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const promptAddCallbackRef = useRef<AgentOrchestrateAddActionOptions['onAdded']>(undefined)
  const handleOpenUpload = useCallback((options?: AgentOrchestrateAddActionOptions) => {
    promptAddCallbackRef.current = options?.onAdded
    setIsUploadOpen(true)
  }, [])
  useRegisterAgentOrchestrateAddAction('skills', handleOpenUpload)
  const handleUploaded = useCallback((skill: AgentSkill) => {
    setSkills(skills.some(currentSkill => currentSkill.id === skill.id)
      ? skills
      : [...skills, skill])
    promptAddCallbackRef.current?.(skill)
    promptAddCallbackRef.current = undefined
  }, [setSkills, skills])
  const handleUploadOpenChange = useCallback((open: boolean) => {
    if (!open)
      promptAddCallbackRef.current = undefined
    setIsUploadOpen(open)
  }, [])

  return (
    <>
      <ConfigureSection
        label={t('agentDetail.configure.skills.label')}
        labelId="agent-configure-skills-label"
        panelId={skillsListId}
        tip={skillsTip}
        tipAriaLabel={skillsTip}
        rootClassName="border-b border-divider-subtle pt-4"
        panelContentClassName="flex flex-col gap-1 pb-4"
        actions={(
          <ConfigureSectionAddButton
            ariaLabel={t('agentDetail.configure.skills.add')}
            onClick={() => handleOpenUpload()}
          />
        )}
      >
        {skills.length === 0
          ? (
              <ConfigureSectionEmpty
                title={t('agentDetail.configure.skills.empty.title')}
                description={t('agentDetail.configure.skills.empty.description')}
              />
            )
          : skills.map(skill => (
              <AgentSkillItem key={skill.id} agentId={agentId} skill={skill} onRemove={removeSkill} />
            ))}
      </ConfigureSection>
      <AgentSkillUploadDialog
        agentId={agentId}
        open={isUploadOpen}
        onOpenChange={handleUploadOpenChange}
        onUploaded={handleUploaded}
      />
    </>
  )
}
