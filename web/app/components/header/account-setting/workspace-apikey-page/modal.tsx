'use client'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { useToastContext } from '@/app/components/base/toast'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { noop } from 'lodash-es'
import { createWorkspaceApiKey, regenerateWorkspaceApiKey, updateWorkspaceApiKey } from '@/service/workspace-api-key'
import type { WorkspaceApiKey } from '@/service/workspace-api-key'
import ScopeSelector from './scope-selector'

export type WorkspaceApiKeyModalProps = {
  data: Partial<WorkspaceApiKey>
  onCancel: () => void
  onSave?: (newData?: WorkspaceApiKey) => void
  isRegenerate?: boolean
  isEdit?: boolean
}

const WorkspaceApiKeyModal: FC<WorkspaceApiKeyModalProps> = ({
  data,
  onCancel,
  onSave,
  isRegenerate = false,
  isEdit = false,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [name, setName] = useState(data.name || '')
  const getExpiresInDays = (data: Partial<WorkspaceApiKey>) => {
    if (typeof data.expires_in_days === 'number') {
      return data.expires_in_days
    }
    if (data.expires_at) {
      const expiresAt = new Date(data.expires_at)
      const now = new Date()
      // Calculate difference in days, rounding up
      const diffMs = expiresAt.getTime() - now.getTime()
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
      // Clamp between 1 and 365
      return Math.min(Math.max(diffDays, 1), 365)
    }
    return 30
  }
  const [expiresInDays, setExpiresInDays] = useState(getExpiresInDays(data))
  const [scopes, setScopes] = useState<string[]>(data.scopes || [])
  const [loading, setLoading] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | undefined>()

  const handleSave = async () => {
    if (!name.trim() && !isRegenerate && !isEdit) {
      notify({ type: 'error', message: t('common.workspaceApiKey.modal.nameError') })
      return
    }

    if (scopes.length === 0 && !isRegenerate && !isEdit) {
      notify({ type: 'error', message: t('common.workspaceApiKey.modal.scopeRequired') })
      return
    }

    const validExpiresInDays = Math.min(Math.max(expiresInDays, 1), 365)

    setLoading(true)
    try {
      let res
      if (isRegenerate && data.id) {
        res = await regenerateWorkspaceApiKey({ keyId: data.id })
        setNewApiKey(res.token)
      }
      else if (isEdit && data.id) {
        res = await updateWorkspaceApiKey({
          keyId: data.id,
          name: name.trim() || data.name,
          scopes: scopes.length > 0 ? scopes : data.scopes,
          expiresInDays: validExpiresInDays,
        })
        notify({ type: 'success', message: t('common.workspaceApiKey.updateSuccess') })
        if (onSave) onSave(res)
      }
      else {
        res = await createWorkspaceApiKey({ name, scopes, expiresInDays: validExpiresInDays })
        setNewApiKey(res.token)
      }
    }
    catch (error) {
      console.error('API key operation failed:', error)
      notify({
        type: 'error',
        message: isEdit
          ? t('common.workspaceApiKey.updateFailed')
          : isRegenerate
          ? t('common.workspaceApiKey.modal.regenerateFailed')
          : t('common.workspaceApiKey.modal.addFailed'),
      })
    }
    finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      notify({ type: 'success', message: t('common.actionMsg.copySuccessfully') })
    })
  }

  // Display API key after creation or regeneration
  if (newApiKey) {
    return (
      <Modal
        isShow
        onClose={noop}
        className='!w-[520px] !max-w-none !p-8 !pb-6'
      >
        <div className='mb-2 text-xl font-semibold text-text-primary'>
          {isRegenerate ? t('common.workspaceApiKey.regeneratedApiKey') : t('common.workspaceApiKey.newApiKey')}
        </div>
        <div className='mb-3 text-sm text-text-secondary'>
          {t('common.workspaceApiKey.newApiKeyDescription')}
        </div>
        <div className='mb-5 rounded-lg border border-util-colors-warning-warning-100 bg-state-warning-hover p-3 text-sm text-text-warning'>
          {t('common.workspaceApiKey.securityWarning')}
        </div>
        <div className='rounded-lg border border-divider-regular bg-components-input-bg-normal p-4'>
          <div className='mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary'>
            {t('common.workspaceApiKey.yourApiKey')}
          </div>
          <div className='flex items-center justify-between'>
            <div className='mr-3 flex-1 break-all font-mono text-sm text-text-primary selection:bg-state-accent-hover'>
              {newApiKey}
            </div>
            <Button
              variant='tertiary'
              size='small'
              onClick={() => copyToClipboard(newApiKey)}
              className='shrink-0'
            >
              <Copy className='h-3.5 w-3.5' />
            </Button>
          </div>
        </div>
        <div className='mt-6 flex items-center justify-end'>
          <Button
            variant='primary'
            onClick={() => {
              setNewApiKey(undefined)
              onCancel()
              if (onSave) onSave()
            }}
          >
            {t('common.operation.done')}
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      isShow
      onClose={noop}
      className='!w-[520px] !max-w-none !p-8 !pb-6'
    >
      <div className='mb-2 text-xl font-semibold text-text-primary'>
        {isRegenerate
          ? t('common.workspaceApiKey.modal.regenerateTitle')
          : isEdit
          ? t('common.workspaceApiKey.modal.editTitle')
          : t('common.workspaceApiKey.modal.addTitle')
        }
      </div>
      <div className='mb-5 text-sm text-text-secondary'>
        {isRegenerate
          ? t('common.workspaceApiKey.modal.regenerateDescription')
          : isEdit
          ? t('common.workspaceApiKey.modal.editDescription')
          : t('common.workspaceApiKey.modal.addDescription')
        }
      </div>

      {(!isRegenerate || isEdit) && (
        <div className='py-2'>
          <div className='text-sm font-medium leading-9 text-text-primary'>
            {t('common.workspaceApiKey.modal.nameLabel')}
          </div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className='focus:border-components-input-border-focus block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-text-primary outline-none focus:border'
            placeholder={t('common.workspaceApiKey.modal.namePlaceholder') || ''}
          />
          <div className='text-sm font-medium leading-9 text-text-primary'>
            {t('common.workspaceApiKey.modal.expiresLabel')}
          </div>
          <input
            type="number"
            min="1"
            max="365"
            value={expiresInDays}
            onChange={e => setExpiresInDays(Number(e.target.value) || 30)}
            className='focus:border-components-input-border-focus block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-text-primary outline-none focus:border'
            placeholder={t('common.workspaceApiKey.modal.expiresPlaceholder')}
          />
          <div className='mt-1 text-xs text-text-tertiary'>
            {t('common.workspaceApiKey.modal.expiresDescription')}
          </div>
          <ScopeSelector
            selectedScopes={scopes}
            onScopesChange={setScopes}
          />
        </div>
      )}

      <div className='mt-6 flex items-center justify-end'>
        <Button
          onClick={onCancel}
          className='mr-2'
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          variant='primary'
          disabled={(isRegenerate ? false : (!name.trim() || scopes.length === 0)) || loading}
          onClick={handleSave}
        >
          {isRegenerate
            ? t('common.workspaceApiKey.regenerate')
            : isEdit
            ? t('common.operation.save')
            : t('common.workspaceApiKey.add')
          }
        </Button>
      </div>
    </Modal>
  )
}

export default WorkspaceApiKeyModal
