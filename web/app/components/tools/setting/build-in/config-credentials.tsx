'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toolCredentialToFormSchemas } from '../../utils/to-form-schema'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import { fetchBuiltInToolCredentialSchema } from '@/service/tools'
import Loading from '@/app/components/base/loading'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'

type Props = {
  credentialValue: Record<string, any>
  collectionName: string
  onCancel: () => void
  onSaved: (value: Record<string, any>) => void
}

const ConfigCredential: FC<Props> = ({
  credentialValue,
  collectionName,
  onCancel,
  onSaved,
}) => {
  const { t } = useTranslation()
  const [credentialSchema, setCredentialSchema] = useState<any>(null)
  useEffect(() => {
    fetchBuiltInToolCredentialSchema(collectionName).then((res) => {
      setCredentialSchema(toolCredentialToFormSchemas(res as any))
    })
  }, [])
  const [tempCredential, setTempCredential] = React.useState<any>(credentialValue)

  return (
    <Drawer
      isShow
      onHide={onCancel}
      title={t('tools.auth.setupModalTitle') as string}
      titleDescription={t('tools.auth.setupModalTitleDescription') as string}
      panelClassName='mt-2 !w-[480px]'
      maxWidthClassName='!max-w-[480px]'
      height='calc(100vh - 16px)'
      contentClassName='!bg-gray-100'
      headerClassName='!border-b-black/5'
      body={

        <div className='px-6 py-3 h-full'>
          {!credentialSchema
            ? <Loading type='app' />
            : (
              <>
                <Form
                  value={tempCredential}
                  onChange={setTempCredential}
                  formSchemas={credentialSchema}
                  isEditMode={true}
                  showOnVariableMap={{}}
                  validating={false}
                  inputClassName='!bg-gray-50'
                />
                <div className='mt-2 flex justify-between'>
                  <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onCancel}>{t('common.operation.remove')}</Button>
                  <div className='flex space-x-2'>
                    <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onCancel}>{t('common.operation.cancel')}</Button>
                    <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' type='primary' onClick={() => onSaved(tempCredential)}>{t('common.operation.save')}</Button>
                  </div>
                </div>
              </>
            )}

        </div>
      }
      isShowMask={true}
      clickOutsideNotOpen={false}
    />
  )
}
export default React.memo(ConfigCredential)
