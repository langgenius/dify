'use client'

import type { SkillTemplateSummary } from './templates/types'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { SearchMenu } from '@/app/components/base/icons/src/vender/knowledge'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useBatchUpload } from '@/service/use-app-asset'
import { useExistingSkillNames } from '../hooks/file-tree/data/use-skill-asset-tree'
import { useSkillTreeUpdateEmitter } from '../hooks/file-tree/data/use-skill-tree-collaboration'
import SectionHeader from './section-header'
import TemplateCard from './template-card'
import TemplateSearch from './template-search'
import { SKILL_TEMPLATES } from './templates/registry'
import { buildUploadDataFromTemplate } from './templates/template-to-upload'

const SkillTemplatesSection = () => {
  const { t } = useTranslation('workflow')
  const [searchQuery, setSearchQuery] = useState('')
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

  const { data: existingNames } = useExistingSkillNames()
  const existingNamesRef = useRef(existingNames)
  existingNamesRef.current = existingNames

  const handleUse = useCallback(async (summary: SkillTemplateSummary) => {
    const entry = SKILL_TEMPLATES.find(e => e.id === summary.id)
    if (!entry || !appId || existingNamesRef.current?.has(summary.id))
      return

    setLoadingId(summary.id)
    storeApi.getState().setUploadStatus('uploading')
    storeApi.getState().setUploadProgress({ uploaded: 0, total: 1, failed: 0 })

    try {
      const children = await entry.loadContent()
      const uploadData = await buildUploadDataFromTemplate(summary.id, children)

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

  const filtered = useMemo(() => {
    if (!searchQuery)
      return SKILL_TEMPLATES
    const q = searchQuery.toLowerCase()
    return SKILL_TEMPLATES.filter(entry =>
      entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q),
    )
  }, [searchQuery])

  return (
    <section className="flex flex-1 flex-col gap-3">
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
            <div className="flex flex-1 flex-col items-center justify-center gap-y-2">
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
