'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Drawer from '@/app/components/base/drawer'
import Button from '@/app/components/base/button'
// import Toast from '@/app/components/base/toast'
// import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
// import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import cn from '@/utils/classnames'

type Props = {
  onCancel: () => void
  // onSaved: (value: Record<string, any>) => void
  onRemove?: () => void
}

const EndpointModal: FC<Props> = ({
  onCancel,
  // onSaved,
  onRemove = () => { },
}) => {
  const { t } = useTranslation()
  const language = useLanguage()

  const handleSave = () => {
    // for (const field of credentialSchema) {
    //   if (field.required && !tempCredential[field.name]) {
    //     Toast.notify({ type: 'error', message: t('common.errorMsg.fieldRequired', { field: field.label[language] || field.label.en_US }) })
    //     return
    //   }
    // }
    // onSaved(tempCredential)
  }

  return (
    <Drawer
      isOpen
      clickOutsideNotOpen={false}
      onClose={onCancel}
      footer={null}
      mask
      positionCenter={false}
      panelClassname={cn('justify-start mt-[64px] mr-2 mb-2 !w-[420px] !max-w-[420px] !p-0 !bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadow-xl')}
    >
      <>
        {/* <Form
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
        /> */}
        <div className={cn('mt-2 flex justify-end')} >
          < div className='flex space-x-2'>
            <Button onClick={onCancel}>{t('common.operation.cancel')}</Button>
            <Button variant='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
          </div>
        </div>
      </>
    </Drawer>
  )
}
export default React.memo(EndpointModal)
