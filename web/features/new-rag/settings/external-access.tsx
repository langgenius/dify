'use client'

import type { KnowledgeFsExternalAccessResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ExternalAccessDraft } from './model'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { SettingsFieldRow } from './settings-field-row'
import {
  invalidateKnowledgeSettingsAtom,
  knowledgeSettingsExternalAccessAtom,
  knowledgeSettingsSpaceAtom,
} from './state/queries'
import { setKnowledgeSettingsSavePendingAtom } from './state/workflow'

const API_ACCESS_DESCRIPTION_ID = 'knowledge-api-access-description'
const WORKFLOW_ACCESS_DESCRIPTION_ID = 'knowledge-workflow-access-description'

const READ_ONLY_EXTERNAL_ACCESS: KnowledgeFsExternalAccessResponse = {
  agent_enabled: false,
  mcp_enabled: false,
  revision: 1,
  service_api_enabled: false,
  workflow_enabled: false,
}

function externalAccessDraftFromServer(
  externalAccess: KnowledgeFsExternalAccessResponse,
): ExternalAccessDraft {
  return {
    apiEnabled: externalAccess.service_api_enabled && externalAccess.agent_enabled,
    workflowEnabled: externalAccess.workflow_enabled,
  }
}

export function ExternalAccessSection() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const externalAccess =
    useAtomValue(knowledgeSettingsExternalAccessAtom) ?? READ_ONLY_EXTERNAL_ACCESS
  const invalidateSettings = useSetAtom(invalidateKnowledgeSettingsAtom)
  const setSavePending = useSetAtom(setKnowledgeSettingsSavePendingAtom)
  const [draft, setDraft] = useState<ExternalAccessDraft>()
  const queuedDraftRef = useRef<ExternalAccessDraft | undefined>(undefined)
  const saveInFlightRef = useRef(false)
  const mutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess.put.mutationOptions(),
  )

  if (!space) return null
  const serverDraft = externalAccessDraftFromServer(externalAccess)
  const current = draft ?? serverDraft
  const canEdit = space.permission_keys.includes('knowledge_space_edit')
  const canManageAccess = space.permission_keys.includes('knowledge_space_access_config')
  const disabled = !canEdit || !canManageAccess

  const showSaveError = (error?: unknown) =>
    toast.error(
      error instanceof Response && error.status === 403
        ? t(($) => $['newKnowledge.permissionRestricted'])
        : t(($) => $['newKnowledge.settings.saveFailed']),
    )

  const save = async (nextDraft: ExternalAccessDraft) => {
    setDraft(nextDraft)
    if (disabled) return
    if (saveInFlightRef.current) {
      queuedDraftRef.current = nextDraft
      return
    }

    saveInFlightRef.current = true
    setSavePending({ owner: 'external-access', pending: true })
    let pendingDraft: ExternalAccessDraft | undefined = nextDraft
    let savedDraft = nextDraft
    while (pendingDraft) {
      queuedDraftRef.current = undefined
      try {
        await mutation.mutateAsync({
          body: {
            agent_enabled: pendingDraft.apiEnabled,
            mcp_enabled: externalAccess.mcp_enabled,
            service_api_enabled: pendingDraft.apiEnabled,
            workflow_enabled: pendingDraft.workflowEnabled,
          },
          params: { control_space_id: space.control_space_id },
        })
        savedDraft = pendingDraft
        pendingDraft = queuedDraftRef.current
      } catch (error) {
        queuedDraftRef.current = undefined
        saveInFlightRef.current = false
        setSavePending({ owner: 'external-access', pending: false })
        showSaveError(error)
        return
      }
    }

    saveInFlightRef.current = false
    toast.success(tCommon(($) => $['api.actionSuccess']))
    try {
      await invalidateSettings()
    } finally {
      setDraft(savedDraft)
      setSavePending({ owner: 'external-access', pending: false })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="h-px bg-divider-subtle" />
      <SettingsFieldRow label={t(($) => $['newKnowledge.settings.apiAccessLabel'])}>
        <div className="flex min-h-7 items-center gap-2">
          <Switch
            aria-label={t(($) => $['newKnowledge.apiAgentAccess'])}
            aria-describedby={API_ACCESS_DESCRIPTION_ID}
            checked={current.apiEnabled}
            disabled={disabled}
            onCheckedChange={(apiEnabled) =>
              void save({ apiEnabled, workflowEnabled: current.workflowEnabled })
            }
          />
          <p
            id={API_ACCESS_DESCRIPTION_ID}
            className="min-w-0 flex-1 system-xs-regular text-text-tertiary"
          >
            {t(($) => $['newKnowledge.settings.apiAccessDescription'])}
          </p>
        </div>
      </SettingsFieldRow>

      <SettingsFieldRow label={t(($) => $['newKnowledge.settings.workflowAccessLabel'])}>
        <div className="flex min-h-7 items-center gap-2">
          <Switch
            aria-label={t(($) => $['newKnowledge.workflowAccess'])}
            aria-describedby={WORKFLOW_ACCESS_DESCRIPTION_ID}
            checked={current.workflowEnabled}
            disabled={disabled}
            onCheckedChange={(workflowEnabled) =>
              void save({ apiEnabled: current.apiEnabled, workflowEnabled })
            }
          />
          <p
            id={WORKFLOW_ACCESS_DESCRIPTION_ID}
            className="min-w-0 flex-1 system-xs-regular text-text-tertiary"
          >
            {t(($) => $['newKnowledge.settings.workflowAccessDescription'])}
          </p>
        </div>
      </SettingsFieldRow>
    </div>
  )
}
