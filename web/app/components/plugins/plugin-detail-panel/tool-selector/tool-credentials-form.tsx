'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightUpLine,
} from '@remixicon/react'
import { addDefaultValue, toolCredentialToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { Collection } from '@/app/components/tools/types'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import { fetchBuiltInToolCredential, fetchBuiltInToolCredentialSchema } from '@/service/tools'
import Loading from '@/app/components/base/loading'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import cn from '@/utils/classnames'

type Props = {
  collection: Collection
  onCancel: () => void
  onSaved: (value: Record<string, any>) => void
}

const ToolCredentialForm: FC<Props> = ({
  collection,
  onCancel,
  onSaved,
}) => {
  const getValueFromI18nObject = useRenderI18nObject()
  const { t } = useTranslation()
  const [credentialSchema, setCredentialSchema] = useState<any>(null)
  const { name: collectionName } = collection
  const [tempCredential, setTempCredential] = React.useState<any>({})
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

  const handleSave = () => {
    for (const field of credentialSchema) {
      if (field.required && !tempCredential[field.name]) {
        Toast.notify({ type: 'error', message: t('common.errorMsg.fieldRequired', { field: getValueFromI18nObject(field.label) }) })
        return
      }
    }
    onSaved(tempCredential)
  }

  return (
    <>
      {!credentialSchema
        ? <div className='pt-3'><Loading type='app' /></div>
        : (
          <>
            <div className='max-h-[464px] overflow-y-auto px-4'>
              <Form
                value={tempCredential}
                onChange={(v) => {
                  setTempCredential(v)
                }}
                formSchemas={credentialSchema}
                isEditMode={true}
                showOnVariableMap={{}}
                validating={false}
                inputClassName='bg-components-input-bg-normal hover:bg-components-input-bg-hover'
                fieldMoreInfo={item => item.url
                  ? (<a
                    href={item.url}
                    target='_blank' rel='noopener noreferrer'
                    className='text-text-accent inline-flex items-center text-xs'
                  >
                    {t('tools.howToGet')}
                    <RiArrowRightUpLine className='ml-1 h-3 w-3' />
                  </a>)
                  : null}
              />
            </div>
            <div className={cn('mt-1 flex justify-end px-4')} >
              <div className='flex space-x-2'>
                <Button onClick={onCancel}>{t('common.operation.cancel')}</Button>
                <Button variant='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
              </div>
            </div>
          </>
        )
      }

    </>
  )
}
export default React.memo(ToolCredentialForm)
