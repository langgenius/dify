'use client'

import type { AgentSkill } from './agent-skill-item'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
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
  const [isExpanded, setIsExpanded] = useState(true)
  const skillsTip = t('agentDetail.configure.skills.tip')
  const skillsListId = 'agent-configure-skills-list'

  return (
    <section className={cn('border-b border-divider-subtle pt-4', isExpanded && 'pb-4')} aria-labelledby="agent-configure-skills-label">
      <div className="mb-2 flex min-h-6 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <h3
            id="agent-configure-skills-label"
            className="truncate system-sm-semibold-uppercase text-text-secondary"
          >
            {t('agentDetail.configure.skills.label')}
          </h3>
          <Infotip aria-label={skillsTip} popupClassName="max-w-64">
            {skillsTip}
          </Infotip>
          <button
            type="button"
            aria-label={t('agentDetail.configure.skills.toggle')}
            aria-controls={skillsListId}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded(expanded => !expanded)}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-quaternary hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span
              aria-hidden
              className={`i-custom-vender-solid-arrows-arrow-down-round-fill size-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
            />
          </button>
        </div>

        <button
          type="button"
          aria-label={t('agentDetail.configure.skills.add')}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-add-line size-4" />
        </button>
      </div>

      {isExpanded && (
        <div id={skillsListId} className="flex flex-col gap-1">
          {skills.map(skill => (
            <AgentSkillItem key={skill.id} skill={skill} />
          ))}
        </div>
      )}
    </section>
  )
}
