'use client'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiLoader2Line,
} from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import {
  useBuildTriggerSubscription,
  useCreateTriggerSubscriptionBuilder,
  useTriggerSubscriptionBuilderLogs,
} from '@/service/use-triggers'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { BaseForm } from '@/app/components/base/form/components/base'
import ActionButton from '@/app/components/base/action-button'
import { CopyFeedbackNew } from '@/app/components/base/copy-feedback'
import type { FormRefObject } from '@/app/components/base/form/types'
import LogViewer from '../log-viewer'
import { usePluginStore } from '../../store'

type Props = {
  onClose: () => void
  onSuccess: () => void
}

export const ManualCreateModal = ({ onClose, onSuccess }: Props) => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)

  const [subscriptionName, setSubscriptionName] = useState('')
  const [subscriptionBuilder, setSubscriptionBuilder] = useState<TriggerSubscriptionBuilder | undefined>()

  const { mutate: createBuilder /* isPending: isCreatingBuilder */ } = useCreateTriggerSubscriptionBuilder()
  const { mutate: buildSubscription, isPending: isBuilding } = useBuildTriggerSubscription()

  const providerName = `${detail?.plugin_id}/${detail?.declaration.name}`
  const propertiesSchema = detail?.declaration.trigger.subscription_schema.properties_schema || []
  const propertiesFormRef = React.useRef<FormRefObject>(null)

  const { data: logData } = useTriggerSubscriptionBuilderLogs(
    providerName,
    subscriptionBuilder?.id || '',
    {
      enabled: !!subscriptionBuilder?.id,
      refetchInterval: 3000,
    },
  )

  const logs = logData?.logs || []

  useEffect(() => {
    if (!subscriptionBuilder) {
      createBuilder(
        {
          provider: providerName,
          credential_type: TriggerCredentialTypeEnum.Unauthorized,
        },
        {
          onSuccess: (response) => {
            const builder = response.subscription_builder
            setSubscriptionBuilder(builder)
          },
          onError: (error) => {
            Toast.notify({
              type: 'error',
              message: t('pluginTrigger.modal.errors.createFailed'),
            })
            console.error('Failed to create subscription builder:', error)
          },
        },
      )
    }
  }, [createBuilder, providerName, subscriptionBuilder, t])

  const handleCreate = () => {
    if (!subscriptionName.trim()) {
      Toast.notify({
        type: 'error',
        message: t('pluginTrigger.modal.form.subscriptionName.required'),
      })
      return
    }

    if (!subscriptionBuilder)
      return

    const formValues = propertiesFormRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }
    if (!formValues.isCheckValidated) {
      Toast.notify({
        type: 'error',
        message: t('pluginTrigger.modal.form.properties.required'),
      })
      return
    }

    buildSubscription(
      {
        provider: providerName,
        subscriptionBuilderId: subscriptionBuilder.id,
        params: {
          name: subscriptionName,
          properties: formValues.values,
        },
      },
      {
        onSuccess: () => {
          Toast.notify({
            type: 'success',
            message: 'Subscription created successfully',
          })
          onSuccess()
          onClose()
        },
        onError: (error: any) => {
          Toast.notify({
            type: 'error',
            message: error?.message || t('pluginTrigger.modal.errors.createFailed'),
          })
        },
      },
    )
  }

  return (
    <Modal
      isShow
      onClose={onClose}
      className='!max-w-[640px] !p-0'
      wrapperClassName='!z-[1002]'
    >
      <div className='flex items-center justify-between p-6 pb-3'>
        <h3 className='text-lg font-semibold text-text-primary'>
          {t('pluginTrigger.modal.manual.title')}
        </h3>
        <ActionButton onClick={onClose} >
          <RiCloseLine className='h-4 w-4' />
        </ActionButton>
      </div>

      <div className='max-h-[70vh] overflow-y-auto p-6 pt-2'>
        <div className='mb-6'>
          <label className='system-sm-medium mb-2 block text-text-primary'>
            {t('pluginTrigger.modal.form.subscriptionName.label')}
          </label>
          <Input
            value={subscriptionName}
            onChange={e => setSubscriptionName(e.target.value)}
            placeholder={t('pluginTrigger.modal.form.subscriptionName.placeholder')}
          />
        </div>

        <div className='mb-6'>
          <label className='system-sm-medium mb-2 block text-text-primary'>
            {t('pluginTrigger.modal.form.callbackUrl.label')}
          </label>
          <div className='relative'>
            <Input
              value={subscriptionBuilder?.endpoint}
              readOnly
              className='pr-12'
              placeholder={t('pluginTrigger.modal.form.callbackUrl.placeholder')}
            />
            <CopyFeedbackNew className='absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary' content={subscriptionBuilder?.endpoint || ''} />
          </div>
          <div className='system-xs-regular mt-1 text-text-tertiary'>
            {t('pluginTrigger.modal.form.callbackUrl.description')}
          </div>
        </div>
        {propertiesSchema.length > 0 && (
          <div className='mb-6'>
            <BaseForm
              formSchemas={propertiesSchema}
              ref={propertiesFormRef}
            />
          </div>
        )}

        <div className='mb-6'>
          <div className='mb-3 flex items-center gap-2'>
            <div className='system-xs-medium-uppercase text-text-tertiary'>
              REQUESTS HISTORY
            </div>
            <div className='h-px flex-1 bg-gradient-to-r from-divider-regular to-transparent' />
          </div>

          <div className='mb-1 flex items-center justify-center gap-1 rounded-lg bg-background-section p-3'>
            <div className='h-3.5 w-3.5'>
              <RiLoader2Line className='h-full w-full animate-spin' />
            </div>
            <div className='system-xs-regular text-text-tertiary'>
              Awaiting request from {detail?.declaration.name}...
            </div>
          </div>

          <LogViewer logs={logs} />
        </div>
      </div>

      <div className='flex justify-end gap-2 p-6 pt-4'>
        <Button variant='secondary' onClick={onClose}>
          {t('pluginTrigger.modal.common.cancel')}
        </Button>
        <Button
          variant='primary'
          onClick={handleCreate}
          loading={isBuilding}
          disabled={!subscriptionName.trim() || !subscriptionBuilder}
        >
          {isBuilding ? t('pluginTrigger.modal.common.creating') : t('pluginTrigger.modal.common.create')}
        </Button>
      </div>
    </Modal>
  )
}
