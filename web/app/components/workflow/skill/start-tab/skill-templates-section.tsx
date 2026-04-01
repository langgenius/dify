'use client'

import type { SkillTemplateSummary } from './templates/types'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchMenu } from '@/app/components/base/icons/src/vender/knowledge'
import { useExistingSkillNames } from '../hooks/file-tree/data/use-skill-asset-tree'
import SectionHeader from './section-header'
import TemplateCard from './template-card'
import TemplateSearch from './template-search'
import { SKILL_TEMPLATES } from './templates/registry'
import { buildUploadDataFromTemplate } from './templates/template-to-upload'
import { useSkillBatchUpload } from './use-skill-batch-upload'

const SkillTemplatesSection = () => {
  const { t } = useTranslation('workflow')
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const { appId, startUpload, failUpload, uploadTree } = useSkillBatchUpload()

  const { data: existingNames } = useExistingSkillNames()

  const handleUse = useCallback(async (summary: SkillTemplateSummary) => {
    const entry = SKILL_TEMPLATES.find(e => e.id === summary.id)
    if (!entry || !appId || existingNames?.has(summary.id))
      return

    setLoadingId(summary.id)
    startUpload(1)

    try {
      const children = await entry.loadContent()
      const uploadData = await buildUploadDataFromTemplate(summary.id, children)
      await uploadTree(uploadData)
    }
    catch {
      failUpload()
    }
    finally {
      setLoadingId(null)
    }
  }, [appId, existingNames, failUpload, startUpload, uploadTree])

  const filtered = useMemo(() => {
    if (!searchQuery)
      return SKILL_TEMPLATES
    const q = searchQuery.toLowerCase()
    return SKILL_TEMPLATES.filter(entry =>
      entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q),
    )
  }, [searchQuery])

  return (
    <section className="flex flex-col gap-3">
      <div className="sticky top-0 z-10 flex flex-col gap-3 bg-components-panel-bg px-6 pb-1 pt-2">
        <SectionHeader
          title={t('skill.startTab.templatesTitle')}
          description={t('skill.startTab.templatesDesc')}
        />
        <div className="flex w-full items-start gap-1">
          {/* TODO: replace with CategoryTabs once marketplace API provides tag/category data */}
          <div className="flex-1" />
          <TemplateSearch onChange={setSearchQuery} />
        </div>
      </div>
      {filtered.length === 0 && searchQuery
        ? (
            <div className="flex min-h-60 flex-col items-center justify-center gap-y-2 px-6">
              <SearchMenu className="size-12 text-text-quaternary" />
              <span className="text-text-tertiary system-sm-regular">
                {t('skill.startTab.noTemplatesFound')}
              </span>
            </div>
          )
        : (
            <div className="grid grid-cols-3 gap-3 px-6">
              {filtered.map(entry => (
                <TemplateCard
                  key={entry.id}
                  template={entry}
                  added={existingNames?.has(entry.id) ?? false}
                  disabled={loadingId !== null}
                  loading={loadingId === entry.id}
                  onUse={handleUse}
                />
              ))}
            </div>
          )}
    </section>
  )
}

export default memo(SkillTemplatesSection)
