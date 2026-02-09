'use client'

import dynamic from 'next/dynamic'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionCard from './action-card'
import CreateBlankSkillModal from './create-blank-skill-modal'

const ImportSkillModal = dynamic(() => import('./import-skill-modal'), {
  ssr: false,
})

const CreateImportSection = () => {
  const { t } = useTranslation('workflow')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)

  return (
    <>
      <div className="grid grid-cols-3 gap-2 px-6 pb-4 pt-6">
        <ActionCard
          icon={<span className="i-ri-add-circle-fill size-5 text-text-accent" />}
          title={t('skill.startTab.createBlankSkill')}
          description={t('skill.startTab.createBlankSkillDesc')}
          onClick={() => setIsCreateModalOpen(true)}
        />
        <ActionCard
          icon={<span className="i-ri-upload-line size-5 text-text-accent" />}
          title={t('skill.startTab.importSkill')}
          description={t('skill.startTab.importSkillDesc')}
          onClick={() => setIsImportModalOpen(true)}
        />
      </div>
      <CreateBlankSkillModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
      <ImportSkillModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </>
  )
}

export default memo(CreateImportSection)
