'use client'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiFileCopyLine,
} from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import {
  useBuildTriggerSubscription,
  useCreateTriggerSubscriptionBuilder,
  // useTriggerSubscriptionBuilderLogs,
} from '@/service/use-triggers'
import type { PluginDetail } from '@/app/components/plugins/types'
import cn from '@/utils/classnames'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
// import { BaseForm } from '@/app/components/base/form/components/base'
// import type { FormRefObject } from '@/app/components/base/form/types'
import ActionButton from '@/app/components/base/action-button'
import { CopyFeedbackNew } from '@/app/components/base/copy-feedback'

type Props = {
  pluginDetail: PluginDetail
  onClose: () => void
  onSuccess: () => void
}

// type LogEntry = {
//   timestamp: string
//   method: string
//   path: string
//   status: number
//   headers: Record<string, any>
//   body: any
//   response: any
// }

const ManualAddModal = ({ pluginDetail, onClose, onSuccess }: Props) => {
  const { t } = useTranslation()

  // Form state
  const [subscriptionName, setSubscriptionName] = useState('')
  const [subscriptionBuilder, setSubscriptionBuilder] = useState<TriggerSubscriptionBuilder | undefined>()
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  // const formRef = React.useRef<FormRefObject>(null)

  // API mutations
  const { mutate: createBuilder /* isPending: isCreatingBuilder */ } = useCreateTriggerSubscriptionBuilder()
  const { mutate: buildSubscription, isPending: isBuilding } = useBuildTriggerSubscription()

  // Get provider name
  const providerName = `${pluginDetail.plugin_id}/${pluginDetail.declaration.name}`

  // const { data: logs, isLoading: isLoadingLogs } = useTriggerSubscriptionBuilderLogs(
  //   providerName,
  //   subscriptionBuilder?.id || '',
  //   {
  //     enabled: !!subscriptionBuilder?.id,
  //     refetchInterval: 3000, // Poll every 3 seconds
  //   },
  // )

  // Mock data for demonstration
  const mockLogs = [
    {
      id: '1',
      timestamp: '2024-01-15T18:09:14Z',
      method: 'POST',
      path: '/webhook',
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Slack-Hooks/1.0',
        'X-Slack-Signature': 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503',
      },
      body: {
        verification_token: 'secret_tMrlL1qK5vuQAhCh',
        event: {
          type: 'message',
          text: 'Hello world',
          user: 'U1234567890',
        },
      },
      response: {
        error: 'Internal server error',
        message: 'Failed to process webhook',
      },
    },
    {
      id: '2',
      timestamp: '2024-01-15T18:09:14Z',
      method: 'POST',
      path: '/webhook',
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Slack-Hooks/1.0',
      },
      body: {
        verification_token: 'secret_tMrlL1qK5vuQAhCh',
      },
      response: {
        success: true,
      },
    },
    {
      id: '3',
      timestamp: '2024-01-15T18:09:14Z',
      method: 'POST',
      path: '/webhook',
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Slack-Hooks/1.0',
      },
      body: {
        verification_token: 'secret_tMrlL1qK5vuQAhCh',
      },
      response: {
        output: {
          output: 'I am the GPT-3 model from OpenAI, an artificial intelligence assistant.',
        },
        raw_output: 'I am the GPT-3 model from OpenAI, an artificial intelligence assistant.',
      },
    },
  ]

  const logs = mockLogs
  const isLoadingLogs = false

  // Create subscription builder on mount
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

    // Get form values using the ref (for future use if needed)
    // const formValues = formRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }

    buildSubscription(
      {
        provider: providerName,
        subscriptionBuilderId: subscriptionBuilder.id,
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

  const toggleLogExpansion = (logId: string) => {
    const newExpanded = new Set(expandedLogs)
    if (newExpanded.has(logId))
      newExpanded.delete(logId)
    else
      newExpanded.add(logId)

    setExpandedLogs(newExpanded)
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
        {/* Subscription Name */}
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

        {/* Callback URL */}
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

        {/* Dynamic Parameters Form */}
        {/* {parametersSchema.length > 0 && (
          <div className='mb-6'>
            <div className='system-sm-medium mb-3 text-text-primary'>
              Subscription Parameters
            </div>
            <BaseForm
              formSchemas={parametersSchema}
              ref={formRef}
            />
          </div>
        )} */}

        {/* Request Logs */}
        {subscriptionBuilder && (
          <div className='mb-6'>
            {/* Divider with Title */}
            <div className='mb-3 flex items-center gap-2'>
              <div className='system-xs-medium-uppercase text-text-tertiary'>
                REQUESTS HISTORY
              </div>
              <div className='h-px flex-1 bg-gradient-to-r from-divider-regular to-transparent' />
            </div>

            {/* Request List */}
            <div className='flex flex-col gap-1'>
              {isLoadingLogs && (
                <div className='flex items-center justify-center gap-1 rounded-lg bg-background-section p-3'>
                  <div className='h-3.5 w-3.5'>
                    <svg className='animate-spin' viewBox='0 0 24 24'>
                      <circle cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='2' fill='none' strokeDasharray='31.416' strokeDashoffset='31.416'>
                        <animate attributeName='stroke-dasharray' dur='2s' values='0 31.416;15.708 15.708;0 31.416' repeatCount='indefinite' />
                        <animate attributeName='stroke-dashoffset' dur='2s' values='0;-15.708;-31.416' repeatCount='indefinite' />
                      </circle>
                    </svg>
                  </div>
                  <div className='system-xs-regular text-text-tertiary'>
                    Awaiting request from Slack...
                  </div>
                </div>
              )}

              {!isLoadingLogs && logs && logs.length > 0 && (
                <>
                  {logs.map((log, index) => {
                    const logId = log.id || index.toString()
                    const isExpanded = expandedLogs.has(logId)
                    const isSuccess = log.status >= 200 && log.status < 300
                    const isError = log.status >= 400

                    return (
                      <div
                        key={logId}
                        className={cn(
                          'relative rounded-lg border shadow-sm',
                          isError && 'border-state-destructive-border bg-white',
                          !isError && isExpanded && 'border-components-panel-border bg-white',
                          !isError && !isExpanded && 'border-components-panel-border bg-background-section',
                        )}
                      >
                        {/* Error background decoration */}
                        {isError && (
                          <div className='absolute -left-1 -top-4 h-16 w-16 opacity-10'>
                            <div className='h-full w-full rounded-full bg-text-destructive' />
                          </div>
                        )}

                        {/* Request Header */}
                        <button
                          onClick={() => toggleLogExpansion(logId)}
                          className={cn(
                            'flex w-full items-center justify-between px-2 py-1.5 text-left',
                            isExpanded ? 'pb-1 pt-2' : 'min-h-7',
                          )}
                        >
                          <div className='flex items-center gap-0'>
                            {isExpanded ? (
                              <RiArrowDownSLine className='h-4 w-4 text-text-tertiary' />
                            ) : (
                              <RiArrowRightSLine className='h-4 w-4 text-text-tertiary' />
                            )}
                            <div className='system-xs-semibold-uppercase text-text-secondary'>
                              REQUEST #{index + 1}
                            </div>
                          </div>

                          <div className='flex items-center gap-1'>
                            <div className='system-xs-regular text-text-tertiary'>
                              {new Date(log.timestamp).toLocaleTimeString('en-US', {
                                hour12: false,
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </div>
                            <div className='h-3.5 w-3.5'>
                              {isSuccess ? (
                                <RiCheckboxCircleLine className='text-state-success-text h-full w-full' />
                              ) : (
                                <RiErrorWarningLine className='text-state-destructive-text h-full w-full' />
                              )}
                            </div>
                          </div>
                        </button>

                        {/* Expanded Content */}
                        {isExpanded && (
                          <div className='flex flex-col gap-1 px-1 pb-1'>
                            {/* Request Block */}
                            <div className='rounded-md bg-components-input-bg-normal'>
                              <div className='flex items-center justify-between px-2 py-1'>
                                <div className='system-xs-semibold-uppercase text-text-secondary'>
                                  REQUEST
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    navigator.clipboard.writeText(JSON.stringify(log.body, null, 2))
                                    Toast.notify({ type: 'success', message: 'Copied to clipboard' })
                                  }}
                                  className='rounded-md p-0.5 hover:bg-components-panel-border'
                                >
                                  <RiFileCopyLine className='h-4 w-4 text-text-tertiary' />
                                </button>
                              </div>
                              <div className='flex px-0 pb-2 pt-1'>
                                <div className='w-7 pr-3 text-right'>
                                  <div className='code-xs-regular text-text-quaternary'>
                                    {JSON.stringify(log.body, null, 2).split('\n').map((_, i) => (
                                      <div key={i}>{String(i + 1).padStart(2, '0')}</div>
                                    ))}
                                  </div>
                                </div>
                                <div className='flex-1 px-3'>
                                  <pre className='code-xs-regular text-text-secondary'>
                                    {JSON.stringify(log.body, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </div>

                            {/* Response Block */}
                            <div className='rounded-md bg-components-input-bg-normal'>
                              <div className='flex items-center justify-between px-2 py-1'>
                                <div className='system-xs-semibold-uppercase text-text-secondary'>
                                  RESPONSE
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    navigator.clipboard.writeText(JSON.stringify(log.response, null, 2))
                                    Toast.notify({ type: 'success', message: 'Copied to clipboard' })
                                  }}
                                  className='rounded-md p-0.5 hover:bg-components-panel-border'
                                >
                                  <RiFileCopyLine className='h-4 w-4 text-text-tertiary' />
                                </button>
                              </div>
                              <div className='flex px-0 pb-2 pt-1'>
                                <div className='w-7 pr-3 text-right'>
                                  <div className='code-xs-regular text-text-quaternary'>
                                    {JSON.stringify(log.response, null, 2).split('\n').map((_, i) => (
                                      <div key={i}>{String(i + 1).padStart(2, '0')}</div>
                                    ))}
                                  </div>
                                </div>
                                <div className='flex-1 px-3'>
                                  <pre className='code-xs-regular text-text-secondary'>
                                    {JSON.stringify(log.response, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              )}

              {!isLoadingLogs && (!logs || logs.length === 0) && (
                <div className='flex items-center justify-center gap-1 rounded-lg bg-background-section p-3'>
                  <div className='h-3.5 w-3.5'>
                    <svg className='animate-spin' viewBox='0 0 24 24'>
                      <circle cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='2' fill='none' strokeDasharray='31.416' strokeDashoffset='31.416'>
                        <animate attributeName='stroke-dasharray' dur='2s' values='0 31.416;15.708 15.708;0 31.416' repeatCount='indefinite' />
                        <animate attributeName='stroke-dashoffset' dur='2s' values='0;-15.708;-31.416' repeatCount='indefinite' />
                      </circle>
                    </svg>
                  </div>
                  <div className='system-xs-regular text-text-tertiary'>
                    Awaiting request from Slack...
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className='flex justify-end gap-2 border-t border-divider-subtle p-6 pt-4'>
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

export default ManualAddModal
