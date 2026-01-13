'use client'
import type { FC } from 'react'
import type { Collection } from '../../types'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Drawer from '@/app/components/base/drawer-plus'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { fetchBuiltInToolCredential, fetchBuiltInToolCredentialSchema } from '@/service/tools'
import { cn } from '@/utils/classnames'
import { addDefaultValue, toolCredentialToFormSchemas } from '../../utils/to-form-schema'

type Props = {
  collection: Collection
  onCancel: () => void
  onSaved: (value: Record<string, any>) => void
  isHideRemoveBtn?: boolean
  onRemove?: () => void
  isSaving?: boolean
}

const ConfigCredential: FC<Props> = ({
  collection,
  onCancel,
  onSaved,
  isHideRemoveBtn,
  onRemove = noop,
  isSaving,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const [credentialSchema, setCredentialSchema] = useState<any>(null)
  const { name: collectionName } = collection
  const [tempCredential, setTempCredential] = React.useState<any>({})
  const [isLoading, setIsLoading] = React.useState(false)
  useEffect(() => {
    fetchBuiltInToolCredentialSchema(collectionName).then(async (res) => {
      const toolCredentialSchemas = toolCredentialToFormSchemas(res)
      const credentialValue = await fetchBuiltInToolCredential(collectionName)
      setTempCredential(credentialValue)
      const defaultCredentials = addDefaultValue(credentialValue, toolCredentialSchemas)
      setCredentialSchema(toolCredentialSchemas)
      setTempCredential(defaultCredentials)
    })
  }, [])

  const handleSave = async () => {
    for (const field of credentialSchema) {
      if (field.required && !tempCredential[field.name]) {
        Toast.notify({ type: 'error', message: t('errorMsg.fieldRequired', { ns: 'common', field: field.label[language] || field.label.en_US }) })
        return
      }
    }
    setIsLoading(true)
    try {
      await onSaved(tempCredential)
      setIsLoading(false)
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <Drawer
      isShow
      onHide={onCancel}
      title={t('auth.setupModalTitle', { ns: 'tools' }) as string}
      titleDescription={t('auth.setupModalTitleDescription', { ns: 'tools' }) as string}
      panelClassName="mt-[64px] mb-2 !w-[420px] border-components-panel-border"
      maxWidthClassName="!max-w-[420px]"
      height="calc(100vh - 64px)"
      contentClassName="!bg-components-panel-bg"
      headerClassName="!border-b-divider-subtle"
      body={(
        <div className="h-full px-6 py-3">
          {!credentialSchema
            ? <Loading type="app" />
            : (
                <>
                  <Form
                    value={tempCredential}
                    onChange={(v) => {
                      setTempCredential(v)
                    }}
                    formSchemas={credentialSchema}
                    isEditMode={true}
                    showOnVariableMap={{}}
                    validating={false}
                    inputClassName="!bg-components-input-bg-normal"
                    fieldMoreInfo={item => item.url
                      ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-xs text-text-accent"
                          >
                            {t('howToGet', { ns: 'tools' })}
                            <LinkExternal02 className="ml-1 h-3 w-3" />
                          </a>
                        )
                      : null}
                  />
                  <div className={cn((collection.is_team_authorization && !isHideRemoveBtn) ? 'justify-between' : 'justify-end', 'mt-2 flex ')}>
                    {
                      (collection.is_team_authorization && !isHideRemoveBtn) && (
                        <Button onClick={onRemove}>{t('operation.remove', { ns: 'common' })}</Button>
                      )
                    }
                    <div className="flex space-x-2">
                      <Button onClick={onCancel}>{t('operation.cancel', { ns: 'common' })}</Button>
                      <Button loading={isLoading || isSaving} disabled={isLoading || isSaving} variant="primary" onClick={handleSave}>{t('operation.save', { ns: 'common' })}</Button>
                    </div>
                  </div>
                </>
              )}

        </div>
      )}
      isShowMask={true}
      clickOutsideNotOpen={false}
    />
  )
}
export default React.memo(ConfigCredential)
