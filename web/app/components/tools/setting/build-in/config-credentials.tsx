'use client'
import type { FC } from 'react'
import type { Collection } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { toast } from '@langgenius/dify-ui/toast'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import Loading from '@/app/components/base/loading'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { fetchBuiltInToolCredential, fetchBuiltInToolCredentialSchema } from '@/service/tools'
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
        toast.error(t('errorMsg.fieldRequired', { ns: 'common', field: field.label[language] || field.label.en_US }))
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
      open
      modal
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-105 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)] data-[swipe-direction=right]:rounded-xl data-[swipe-direction=right]:border-[0.5px] data-[swipe-direction=right]:border-components-panel-border">
            <DrawerContent className="flex min-h-0 flex-1 flex-col bg-components-panel-bg p-0 pb-0">
              <div className="shrink-0 border-b border-divider-subtle py-4">
                <div className="flex h-6 items-center justify-between pr-5 pl-6">
                  <DrawerTitle className="min-w-0 truncate system-xl-semibold text-text-primary">
                    {t('auth.setupModalTitle', { ns: 'tools' })}
                  </DrawerTitle>
                  <DrawerCloseButton
                    aria-label={t('operation.close', { ns: 'common' })}
                    className="h-6 w-6 rounded-md"
                  />
                </div>
                <DrawerDescription className="pr-10 pl-6 system-xs-regular text-text-tertiary">
                  {t('auth.setupModalTitleDescription', { ns: 'tools' })}
                </DrawerDescription>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
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
                          inputClassName="bg-components-input-bg-normal!"
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
                        <div className={cn((collection.is_team_authorization && !isHideRemoveBtn) ? 'justify-between' : 'justify-end', 'mt-2 flex')}>
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
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
export default React.memo(ConfigCredential)
