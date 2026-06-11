'use client'

import type { AgentSkill } from './agent-skill-item'
import { useTranslation } from 'react-i18next'
import { ConfigureSection } from '../configure-section'
import { AgentSkillItem } from './agent-skill-item'

const defaultSkills: AgentSkill[] = [
  {
    id: 'tender-analyzer-1',
    name: 'tender-analyzer',
  },
  {
    id: 'playwright',
    name: 'Playwright',
  },
  {
    id: 'figma-code-connect',
    name: 'Figma Code Connect',
  },
  {
    id: 'tender-analyzer-2',
    name: 'tender-analyzer',
  },
]

export function AgentSkills({
  skills = defaultSkills,
}: {
  skills?: AgentSkill[]
}) {
  const { t } = useTranslation('agentV2')
  const skillsTip = t('agentDetail.configure.skills.tip')
  const skillsListId = 'agent-configure-skills-list'

  return (
    <ConfigureSection
      label={t('agentDetail.configure.skills.label')}
      labelId="agent-configure-skills-label"
      panelId={skillsListId}
      tip={skillsTip}
      tipAriaLabel={skillsTip}
      rootClassName="border-b border-divider-subtle pt-4"
      panelContentClassName="flex flex-col gap-1 pb-4"
      actions={(
        <button
          type="button"
          aria-label={t('agentDetail.configure.skills.add')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-add-line size-4" />
        </button>
      )}
    >
      {skills.map(skill => (
        <AgentSkillItem key={skill.id} skill={skill} />
      ))}
    </ConfigureSection>
  )
}
