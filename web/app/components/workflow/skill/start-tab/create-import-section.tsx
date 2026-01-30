'use client'

import { RiAddCircleFill, RiUploadLine } from '@remixicon/react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionCard from './action-card'
import CreateBlankSkillModal from './create-blank-skill-modal'

const CreateImportSection = () => {
  const { t } = useTranslation('workflow')
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <>
      <div className="grid grid-cols-3 gap-2 px-6 pb-4 pt-6">
        <ActionCard
          icon={<RiAddCircleFill className="size-5 text-text-accent" />}
          title={t('skill.startTab.createBlankSkill')}
          description={t('skill.startTab.createBlankSkillDesc')}
          onClick={() => setIsModalOpen(true)}
        />
        <ActionCard
          icon={<RiUploadLine className="size-5 text-text-accent" />}
          title={t('skill.startTab.importSkill')}
          description={t('skill.startTab.importSkillDesc')}
        />
      </div>
      <CreateBlankSkillModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  )
}

export default memo(CreateImportSection)
