'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/app/components/base/ui/dialog'
import { toast } from '@/app/components/base/ui/toast'
import Field from '@/app/components/datasets/create/website/base/field'
import { DataSourceProvider } from '@/models/common'
import { createDataSourceApiKeyBinding } from '@/service/datasets'

type Props = {
  onCancel: () => void
  onSaved: () => void
}

const I18N_PREFIX = 'jinaReader'

const ConfigJinaReaderModal: FC<Props> = ({
  onCancel,
  onSaved,
}) => {
  const { t } = useTranslation()
  const apiKeyLabel = t('provider.apiKey', { ns: 'common' })
  const [isSaving, setIsSaving] = useState(false)
  const [apiKey, setApiKey] = useState('')

  const handleSave = useCallback(async () => {
    if (isSaving)
      return
    let errorMsg = ''
    if (!errorMsg) {
      if (!apiKey) {
        errorMsg = t('errorMsg.fieldRequired', {
          ns: 'common',
          field: apiKeyLabel,
        })
      }
    }

    if (errorMsg) {
      toast.error(errorMsg)
      return
    }
    const postData = {
      category: 'website',
      provider: DataSourceProvider.jinaReader,
      credentials: {
        auth_type: 'bearer',
        config: {
          api_key: apiKey,
        },
      },
    }
    try {
      setIsSaving(true)
      await createDataSourceApiKeyBinding(postData)
      toast.success(t('api.success', { ns: 'common' }))
    }
    finally {
      setIsSaving(false)
    }

    onSaved()
  }, [apiKey, apiKeyLabel, isSaving, onSaved, t])

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="w-[640px] max-w-[calc(100vw-1rem)] p-0"
      >
        <div className="px-8 pt-8">
          <div className="mb-4 flex items-center justify-between">
            <DialogTitle className="text-text-primary system-xl-semibold">
              {t(`${I18N_PREFIX}.configJinaReader`, { ns: 'datasetCreation' })}
            </DialogTitle>
          </div>

          <div className="space-y-4">
            <Field
              label={apiKeyLabel}
              labelClassName="!text-sm"
              isRequired
              value={apiKey}
              onChange={(value: string | number) => setApiKey(value as string)}
              placeholder={t(`${I18N_PREFIX}.apiKeyPlaceholder`, { ns: 'datasetCreation' })!}
            />
          </div>
          <div className="my-8 flex h-8 items-center justify-between">
            <a className="flex items-center space-x-1 text-xs font-normal leading-[18px] text-text-accent" target="_blank" rel="noopener noreferrer" href="https://jina.ai/reader/">
              <span>{t(`${I18N_PREFIX}.getApiKeyLinkText`, { ns: 'datasetCreation' })}</span>
              <span aria-hidden className="i-custom-vender-line-general-link-external-02 h-3 w-3" />
            </a>
            <div className="flex">
              <Button
                size="large"
                className="mr-2"
                onClick={onCancel}
              >
                {t('operation.cancel', { ns: 'common' })}
              </Button>
              <Button
                variant="primary"
                size="large"
                onClick={handleSave}
                loading={isSaving}
              >
                {t('operation.save', { ns: 'common' })}
              </Button>
            </div>
          </div>
        </div>
        <div className="border-t-[0.5px] border-t-divider-regular">
          <div className="flex items-center justify-center bg-background-section-burn py-3 text-xs text-text-tertiary">
            <span aria-hidden className="i-custom-vender-solid-security-lock-01 mr-1 h-3 w-3 text-text-tertiary" />
            {t('modelProvider.encrypted.front', { ns: 'common' })}
            <a
              className="mx-1 text-text-accent"
              target="_blank"
              rel="noopener noreferrer"
              href="https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html"
            >
              PKCS1_OAEP
            </a>
            {t('modelProvider.encrypted.back', { ns: 'common' })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(ConfigJinaReaderModal)
