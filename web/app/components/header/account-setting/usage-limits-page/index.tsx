'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import {
  currentWorkspaceAtom,
  currentWorkspaceLoadingAtom,
  isCurrentWorkspaceManagerAtom,
} from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'

export default function UsageLimitsPage() {
  const { t } = useTranslation(['common'])
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const isCurrentWorkspaceLoading = useAtomValue(currentWorkspaceLoadingAtom)
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const queryClient = useQueryClient()
  const updateSettings = useMutation(
    consoleQuery.workspaces.current.settings.post.mutationOptions(),
  )
  const inputId = useId()
  const [draft, setDraft] = useState<string | null>(null)

  const currentValue = String(currentWorkspace.max_active_requests)
  const inputValue = draft ?? currentValue
  const normalizedValue = inputValue.trim()
  const parsedValue = normalizedValue === '' ? Number.NaN : Number(normalizedValue)
  const isValidValue = Number.isInteger(parsedValue) && parsedValue >= 0
  const canSave =
    isCurrentWorkspaceManager &&
    !isCurrentWorkspaceLoading &&
    !updateSettings.isPending &&
    isValidValue &&
    normalizedValue !== currentValue

  const handleSave = async () => {
    if (!canSave) return

    try {
      await updateSettings.mutateAsync({ body: { max_active_requests: parsedValue } })
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.summary.get.queryKey(),
      })
      setDraft(null)
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully']))
    } catch {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully']))
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <div className="system-md-semibold text-text-primary">
          {t(($) => $['usageLimits.requestConcurrency.title'])}
        </div>
        <div className="mt-1 system-sm-regular text-text-tertiary">
          {t(($) => $['usageLimits.requestConcurrency.description'])}
        </div>
      </div>

      <label htmlFor={inputId} className="mb-2 block system-sm-medium text-text-primary">
        {t(($) => $['usageLimits.maxActiveRequests.label'])}
      </label>
      <div className="max-w-xs">
        <Input
          id={inputId}
          type="number"
          min={0}
          step={1}
          value={inputValue}
          disabled={
            !isCurrentWorkspaceManager || isCurrentWorkspaceLoading || updateSettings.isPending
          }
          aria-invalid={normalizedValue !== '' && !isValidValue}
          placeholder={t(($) => $['usageLimits.maxActiveRequests.placeholder'])}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <div className="mt-2 body-xs-regular text-text-tertiary">
        {t(($) => $['usageLimits.maxActiveRequests.tip'])}
      </div>

      <div className="mt-6 flex justify-end">
        <Button
          size="large"
          variant="primary"
          disabled={!canSave}
          loading={updateSettings.isPending}
          onClick={() => void handleSave()}
        >
          {t(($) => $['operation.save'])}
        </Button>
      </div>
    </div>
  )
}
