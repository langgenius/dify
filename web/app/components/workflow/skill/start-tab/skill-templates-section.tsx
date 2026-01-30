'use client'

import type { SkillTemplateSummary } from './templates/types'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useBatchUpload } from '@/service/use-app-asset'
import { useExistingSkillNames } from '../hooks/use-skill-asset-tree'
import { useSkillTreeUpdateEmitter } from '../hooks/use-skill-tree-collaboration'
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
    <section className="flex flex-col gap-3 px-6 py-2">
      <SectionHeader
        title={t('skill.startTab.templatesTitle')}
        description={t('skill.startTab.templatesDesc')}
      />
      <TemplateSearch onChange={setSearchQuery} />
      <div className="grid grid-cols-3 gap-3">
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
    </section>
  )
}

export default memo(SkillTemplatesSection)
