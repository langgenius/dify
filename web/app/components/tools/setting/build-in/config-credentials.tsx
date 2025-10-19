'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDefaultValue, toolCredentialToFormSchemas } from '../../utils/to-form-schema'
import type { Collection } from '../../types'
import cn from '@/utils/classnames'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import { fetchBuiltInToolCredential, fetchBuiltInToolCredentialSchema } from '@/service/tools'
import Loading from '@/app/components/base/loading'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { noop } from 'lodash-es'

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
        Toast.notify({ type: 'error', message: t('common.errorMsg.fieldRequired', { field: field.label[language] || field.label.en_US }) })
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
      title={t('tools.auth.setupModalTitle') as string}
      titleDescription={t('tools.auth.setupModalTitleDescription') as string}
      panelClassName='mt-[64px] mb-2 !w-[420px] border-components-panel-border'
      maxWidthClassName='!max-w-[420px]'
      height='calc(100vh - 64px)'
      contentClassName='!bg-components-panel-bg'
      headerClassName='!border-b-divider-subtle'
      body={

        <div className='h-full px-6 py-3'>
          {!credentialSchema
            ? <Loading type='app' />
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
                  inputClassName='!bg-components-input-bg-normal'
                  fieldMoreInfo={item => item.url
                    ? (<a
                      href={item.url}
                      target='_blank' rel='noopener noreferrer'
                      className='inline-flex items-center text-xs text-text-accent'
                    >
                      {t('tools.howToGet')}
                      <LinkExternal02 className='ml-1 h-3 w-3' />
                    </a>)
                    : null}
                />
                <div className={cn((collection.is_team_authorization && !isHideRemoveBtn) ? 'justify-between' : 'justify-end', 'mt-2 flex ')} >
                  {
                    (collection.is_team_authorization && !isHideRemoveBtn) && (
                      <Button onClick={onRemove}>{t('common.operation.remove')}</Button>
                    )
                  }
                  <div className='flex space-x-2'>
                    <Button onClick={onCancel}>{t('common.operation.cancel')}</Button>
                    <Button loading={isLoading || isSaving} disabled={isLoading || isSaving} variant='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
                  </div>
                </div>
              </>
            )
          }

        </div >
      }
      isShowMask={true}
      clickOutsideNotOpen={false}
    />
  )
}
export default React.memo(ConfigCredential)
