'use client'

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRemoveSkill, useSkills } from '@/features/agent-v2/agent-composer/store'
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
  const [skills] = useSkills()
  const removeSkill = useRemoveSkill()
  const skillsTip = t('agentDetail.configure.skills.tip')
  const skillsListId = 'agent-configure-skills-list'
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const handleOpenUpload = useCallback(() => {
    setIsUploadOpen(true)
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
            onClick={handleOpenUpload}
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
              <AgentSkillItem key={skill.id} skill={skill} onRemove={removeSkill} />
            ))}
      </ConfigureSection>
      <AgentSkillUploadDialog
        agentId={agentId}
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
      />
    </>
  )
}
