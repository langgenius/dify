'use client'
import type { FC } from 'react'
import type { FormSchema } from '../../base/form/types'
import type { PluginDetail } from '../types'
import { RiArrowRightUpLine, RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Drawer from '@/app/components/base/drawer'
import Toast from '@/app/components/base/toast'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { cn } from '@/utils/classnames'
import { ReadmeEntrance } from '../readme-panel/entrance'

type Props = {
  formSchemas: FormSchema[]
  defaultValues?: any
  onCancel: () => void
  onSaved: (value: Record<string, any>) => void
  pluginDetail: PluginDetail
}

const extractDefaultValues = (schemas: any[]) => {
  const result: Record<string, any> = {}
  for (const field of schemas) {
    if (field.default !== undefined)
      result[field.name] = field.default
  }
  return result
}

const EndpointModal: FC<Props> = ({
  formSchemas,
  defaultValues = {},
  onCancel,
  onSaved,
  pluginDetail,
}) => {
  const getValueFromI18nObject = useRenderI18nObject()
  const { t } = useTranslation()
  const initialValues = Object.keys(defaultValues).length > 0
    ? defaultValues
    : extractDefaultValues(formSchemas)
  const [tempCredential, setTempCredential] = React.useState<any>(initialValues)

  const handleSave = () => {
    for (const field of formSchemas) {
      if (field.required && !tempCredential[field.name]) {
        Toast.notify({ type: 'error', message: t('errorMsg.fieldRequired', { ns: 'common', field: typeof field.label === 'string' ? field.label : getValueFromI18nObject(field.label as Record<string, string>) }) })
        return
      }
    }

    // Fix: Process boolean fields to ensure they are sent as proper boolean values
    const processedCredential = { ...tempCredential }
    formSchemas.forEach((field: any) => {
      if (field.type === 'boolean' && processedCredential[field.name] !== undefined) {
        const value = processedCredential[field.name]
        if (typeof value === 'string')
          processedCredential[field.name] = value === 'true' || value === '1' || value === 'True'
        else if (typeof value === 'number')
          processedCredential[field.name] = value === 1
        else if (typeof value === 'boolean')
          processedCredential[field.name] = value
      }
    })

    onSaved(processedCredential)
  }

  return (
    <Drawer
      isOpen
      clickOutsideNotOpen={false}
      onClose={onCancel}
      footer={null}
      mask
      positionCenter={false}
      panelClassName={cn('mb-2 mr-2 mt-[64px] !w-[420px] !max-w-[420px] justify-start rounded-2xl border-[0.5px] border-components-panel-border !bg-components-panel-bg !p-0 shadow-xl')}
    >
      <>
        <div className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <div className="system-xl-semibold text-text-primary">{t('detailPanel.endpointModalTitle', { ns: 'plugin' })}</div>
            <ActionButton onClick={onCancel}>
              <RiCloseLine className="h-4 w-4" />
            </ActionButton>
          </div>
          <div className="system-xs-regular mt-0.5 text-text-tertiary">{t('detailPanel.endpointModalDesc', { ns: 'plugin' })}</div>
          <ReadmeEntrance pluginDetail={pluginDetail} className="px-0 pt-3" />
        </div>
        <div className="grow overflow-y-auto">
          <div className="px-4 py-2">
            <Form
              value={tempCredential}
              onChange={(v) => {
                setTempCredential(v)
              }}
              formSchemas={formSchemas as any}
              isEditMode={true}
              showOnVariableMap={{}}
              validating={false}
              inputClassName="bg-components-input-bg-normal hover:bg-components-input-bg-hover"
              fieldMoreInfo={item => item.url
                ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="body-xs-regular inline-flex items-center text-text-accent-secondary"
                    >
                      {t('howToGet', { ns: 'tools' })}
                      <RiArrowRightUpLine className="ml-1 h-3 w-3" />
                    </a>
                  )
                : null}
            />
          </div>
          <div className={cn('flex justify-end p-4 pt-0')}>
            <div className="flex gap-2">
              <Button onClick={onCancel}>{t('operation.cancel', { ns: 'common' })}</Button>
              <Button variant="primary" onClick={handleSave}>{t('operation.save', { ns: 'common' })}</Button>
            </div>
          </div>
        </div>
      </>
    </Drawer>
  )
}
export default React.memo(EndpointModal)
