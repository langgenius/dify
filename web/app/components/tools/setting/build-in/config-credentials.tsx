'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { addDefaultValue, toolCredentialToFormSchemas } from '../../utils/to-form-schema'
import type { Collection } from '../../types'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import { fetchBuiltInToolCredential, fetchBuiltInToolCredentialSchema } from '@/service/tools'
import Loading from '@/app/components/base/loading'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'

type Props = {
  collection: Collection
  onCancel: () => void
  onSaved: (value: Record<string, any>) => void
  isHideRemoveBtn?: boolean
  onRemove?: () => void
}

const ConfigCredential: FC<Props> = ({
  collection,
  onCancel,
  onSaved,
  isHideRemoveBtn,
  onRemove = () => { },
}) => {
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
                  onChange={(v) => {
                    setTempCredential(v)
                  }}
                  formSchemas={credentialSchema}
                  isEditMode={true}
                  showOnVariableMap={{}}
                  validating={false}
                  inputClassName='!bg-gray-50'
                  fieldMoreInfo={item => item.url
                    ? (<a
                      href={item.url}
                      target='_blank' rel='noopener noreferrer'
                      className='inline-flex items-center text-xs text-primary-600'
                    >
                      {t('tools.howToGet')}
                      <LinkExternal02 className='ml-1 w-3 h-3' />
                    </a>)
                    : null}
                />
                <div className={cn((collection.is_team_authorization && !isHideRemoveBtn) ? 'justify-between' : 'justify-end', 'mt-2 flex ')} >
                  {
                    (collection.is_team_authorization && !isHideRemoveBtn) && (
                      <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onRemove}>{t('common.operation.remove')}</Button>
                    )
                  }
                  < div className='flex space-x-2'>
                    <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onCancel}>{t('common.operation.cancel')}</Button>
                    <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' type='primary' onClick={() => onSaved(tempCredential)}>{t('common.operation.save')}</Button>
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
