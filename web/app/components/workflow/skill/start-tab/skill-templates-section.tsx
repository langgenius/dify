'use client'

import type { SkillTemplateSummary } from './templates/types'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useBatchUpload } from '@/service/use-app-asset'
import { useSkillTreeUpdateEmitter } from '../hooks/use-skill-tree-collaboration'
import CategoryTabs from './category-tabs'
import SectionHeader from './section-header'
import TemplateCard from './template-card'
import TemplateSearch from './template-search'
import { SKILL_TEMPLATES } from './templates/registry'
import { buildUploadDataFromTemplate } from './templates/template-to-upload'

const SkillTemplatesSection = () => {
  const { t } = useTranslation('workflow')
  const [activeCategory, setActiveCategory] = useState('all')
  const [searchValue, setSearchValue] = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const storeApi = useWorkflowStore()
  const batchUpload = useBatchUpload()
  const batchUploadRef = useRef(batchUpload)
  batchUploadRef.current = batchUpload
  const emitTreeUpdate = useSkillTreeUpdateEmitter()
  const emitTreeUpdateRef = useRef(emitTreeUpdate)
  emitTreeUpdateRef.current = emitTreeUpdate

  const handleUse = useCallback(async (summary: SkillTemplateSummary) => {
    const entry = SKILL_TEMPLATES.find(e => e.id === summary.id)
    if (!entry || !appId)
      return

    setLoadingId(summary.id)
    storeApi.getState().setUploadStatus('uploading')
    storeApi.getState().setUploadProgress({ uploaded: 0, total: 1, failed: 0 })

    try {
      const children = await entry.loadContent()
      const uploadData = await buildUploadDataFromTemplate(summary.name, children)

      await batchUploadRef.current.mutateAsync({
        appId,
        tree: uploadData.tree,
        files: uploadData.files,
        parentId: null,
        onProgress: (uploaded, total) => {
          storeApi.getState().setUploadProgress({ uploaded, total, failed: 0 })
        },
      })

      storeApi.getState().setUploadStatus('success')
      emitTreeUpdateRef.current()
    }
    catch {
      storeApi.getState().setUploadStatus('partial_error')
    }
    finally {
      setLoadingId(null)
    }
  }, [appId, storeApi])

  const filtered = useMemo(() => SKILL_TEMPLATES.filter((entry) => {
    if (searchValue) {
      const q = searchValue.toLowerCase()
      return entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q)
    }
    if (activeCategory !== 'all')
      return entry.tags?.some(tag => tag.toLowerCase() === activeCategory.toLowerCase())
    return true
  }), [searchValue, activeCategory])

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
      <div className="grid grid-cols-3 gap-3">
        {filtered.map(entry => (
          <TemplateCard
            key={entry.id}
            template={entry}
            onUse={handleUse}
          />
        ))}
      </div>
      {loadingId
        ? <div className="pointer-events-none fixed inset-0 z-50" />
        : null}
    </section>
  )
}

export default memo(SkillTemplatesSection)
