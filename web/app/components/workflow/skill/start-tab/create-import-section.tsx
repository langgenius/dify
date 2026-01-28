'use client'

import { RiAddCircleFill, RiUploadLine } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionCard from './action-card'

const CreateImportSection = () => {
  const { t } = useTranslation('workflow')

  return (
    <div className="grid grid-cols-3 gap-2 px-6 pb-4 pt-6">
      <ActionCard
        icon={<RiAddCircleFill className="size-5 text-text-accent" />}
        title={t('skill.startTab.createBlankSkill')}
        description={t('skill.startTab.createBlankSkillDesc')}
      />
      <ActionCard
        icon={<RiUploadLine className="size-5 text-text-accent" />}
        title={t('skill.startTab.importSkill')}
        description={t('skill.startTab.importSkillDesc')}
      />
    </div>
  )
}

export default memo(CreateImportSection)
