'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine, RiCloseLine } from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Drawer from '@/app/components/base/drawer'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import Toast from '@/app/components/base/toast'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import cn from '@/utils/classnames'

type Props = {
  formSchemas: any
  defaultValues?: any
  onCancel: () => void
  onSaved: (value: Record<string, any>) => void
}

const EndpointModal: FC<Props> = ({
  formSchemas,
  defaultValues = {},
  onCancel,
  onSaved,
}) => {
  const getValueFromI18nObject = useRenderI18nObject()
  const { t } = useTranslation()
  const [tempCredential, setTempCredential] = React.useState<any>(defaultValues)

  const handleSave = () => {
    for (const field of formSchemas) {
      if (field.required && !tempCredential[field.name]) {
        Toast.notify({ type: 'error', message: t('common.errorMsg.fieldRequired', { field: getValueFromI18nObject(field.label) }) })
        return
      }
    }
    onSaved(tempCredential)
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
        <div className='p-4 pb-2'>
          <div className='flex items-center justify-between'>
            <div className='text-text-primary system-xl-semibold'>{t('plugin.detailPanel.endpointModalTitle')}</div>
            <ActionButton onClick={onCancel}>
              <RiCloseLine className='w-4 h-4' />
            </ActionButton>
          </div>
          <div className='mt-0.5 text-text-tertiary system-xs-regular'>{t('plugin.detailPanel.endpointModalDesc')}</div>
        </div>
        <div className='grow overflow-y-auto'>
          <div className='px-4 py-2'>
            <Form
              value={tempCredential}
              onChange={(v) => {
                setTempCredential(v)
              }}
              formSchemas={formSchemas}
              isEditMode={true}
              showOnVariableMap={{}}
              validating={false}
              inputClassName='bg-components-input-bg-normal hover:bg-components-input-bg-hover'
              fieldMoreInfo={item => item.url
                ? (<a
                  href={item.url}
                  target='_blank' rel='noopener noreferrer'
                  className='inline-flex items-center body-xs-regular text-text-accent-secondary'
                >
                  {t('tools.howToGet')}
                  <RiArrowRightUpLine className='ml-1 w-3 h-3' />
                </a>)
                : null}
            />
          </div>
          <div className={cn('p-4 pt-0 flex justify-end')} >
            <div className='flex gap-2'>
              <Button onClick={onCancel}>{t('common.operation.cancel')}</Button>
              <Button variant='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
            </div>
          </div>
        </div>
      </>
    </Drawer>
  )
}
export default React.memo(EndpointModal)
