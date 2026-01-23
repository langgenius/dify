'use client'

import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import SectionHeader from './section-header'

const SkillTemplatesSection: FC = () => {
  const { t } = useTranslation('workflow')

  return (
    <section className="px-6">
      <SectionHeader
        title={t('skill.startTab.templatesTitle')}
        description={t('skill.startTab.templatesDesc')}
      />
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-divider-regular bg-background-section-burn">
        <span className="system-sm-regular text-text-quaternary">
          {t('skill.startTab.templatesComingSoon')}
        </span>
      </div>
    </section>
  )
}

export default memo(SkillTemplatesSection)
