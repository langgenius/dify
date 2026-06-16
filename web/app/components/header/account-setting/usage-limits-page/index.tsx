'use client'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { useAppContext } from '@/context/app-context'
import { updateWorkspaceSettings } from '@/service/common'

const UsageLimitsPage = () => {
  const { t } = useTranslation()
  const {
    currentWorkspace,
    isCurrentWorkspaceManager,
    isValidatingCurrentWorkspace,
    mutateCurrentWorkspace,
  } = useAppContext()
  const inputId = useId()
  const initialMaxActiveRequests = String(currentWorkspace.max_active_requests ?? 0)
  const [maxActiveRequests, setMaxActiveRequests] = useState(initialMaxActiveRequests)
  const [isSaving, setIsSaving] = useState(false)

  const normalizedValue = maxActiveRequests.trim()
  const parsedValue = normalizedValue === '' ? Number.NaN : Number(normalizedValue)
  const isValidValue = Number.isInteger(parsedValue) && parsedValue >= 0
  const hasChanges = normalizedValue !== initialMaxActiveRequests
  const canSave = isCurrentWorkspaceManager && isValidValue && hasChanges && !isSaving && !isValidatingCurrentWorkspace

  const handleSave = async () => {
    if (!canSave)
      return

    setIsSaving(true)
    try {
      await updateWorkspaceSettings({
        name: currentWorkspace.name,
        max_active_requests: parsedValue,
      })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      mutateCurrentWorkspace()
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
    }
    finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <div className="system-md-semibold text-text-primary">
          {t('usageLimits.requestConcurrency.title', { ns: 'common' })}
        </div>
        <div className="mt-1 system-sm-regular text-text-tertiary">
          {t('usageLimits.requestConcurrency.description', { ns: 'common' })}
        </div>
      </div>

      <label htmlFor={inputId} className="mb-2 block system-sm-medium text-text-primary">
        {t('usageLimits.maxActiveRequests.label', { ns: 'common' })}
      </label>
      <Input
        id={inputId}
        type="number"
        min={0}
        step={1}
        value={maxActiveRequests}
        disabled={!isCurrentWorkspaceManager || isSaving}
        destructive={normalizedValue !== '' && !isValidValue}
        placeholder={t('usageLimits.maxActiveRequests.placeholder', { ns: 'common' })}
        wrapperClassName="max-w-xs"
        onChange={e => setMaxActiveRequests(e.target.value)}
      />
      <div className="mt-2 body-xs-regular text-text-tertiary">
        {t('usageLimits.maxActiveRequests.tip', { ns: 'common' })}
      </div>

      <div className="mt-6 flex justify-end">
        <Button
          size="large"
          variant="primary"
          disabled={!canSave}
          loading={isSaving}
          onClick={handleSave}
        >
          {t(isSaving ? 'operation.saving' : 'operation.save', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}

export default UsageLimitsPage
