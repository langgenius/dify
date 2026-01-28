'use client'

import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CategoryTabs from './category-tabs'
import SectionHeader from './section-header'
import TemplateSearch from './template-search'

const SkillTemplatesSection = () => {
  const { t } = useTranslation('workflow')
  const [activeCategory, setActiveCategory] = useState('all')
  const [searchValue, setSearchValue] = useState('')

  return (
    <section className="flex flex-col gap-3 px-6 py-2">
      <SectionHeader
        title={t('skill.startTab.templatesTitle')}
        description={t('skill.startTab.templatesDesc')}
      />
      <div className="flex w-full items-start gap-1">
        <CategoryTabs
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />
        <TemplateSearch
          value={searchValue}
          onChange={setSearchValue}
        />
      </div>
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-divider-regular bg-background-section-burn">
        <span className="system-sm-regular text-text-quaternary">
          {t('skill.startTab.templatesComingSoon')}
        </span>
      </div>
    </section>
  )
}

export default memo(SkillTemplatesSection)
