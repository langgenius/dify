'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiEditLine,
  RiKeyLine,
  RiUserLine,
} from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import type { PluginDetail } from '@/app/components/plugins/types'

type Props = {
  pluginDetail: PluginDetail
  onCancel: () => void
  onSaved: (data: any) => void
}

type CreateMode = 'api-key' | 'oauth' | 'manual'

const SubscriptionModal = ({ pluginDetail, onCancel, onSaved }: Props) => {
  const { t } = useTranslation()
  const [selectedMode, setSelectedMode] = useState<CreateMode | null>(null)
  const [subscriptionName, setSubscriptionName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleModeSelect = (mode: CreateMode) => {
    setSelectedMode(mode)
  }

  const handleBack = () => {
    setSelectedMode(null)
  }

  const handleCreate = async () => {
    if (!selectedMode || !subscriptionName.trim()) return

    setIsLoading(true)
    try {
      const subscriptionData = {
        name: subscriptionName,
        mode: selectedMode,
        plugin_id: pluginDetail.plugin_id,
        ...(selectedMode === 'api-key' && { api_key: apiKey }),
        ...(selectedMode === 'manual' && { webhook_url: webhookUrl }),
      }

      onSaved(subscriptionData)
    }
    finally {
      setIsLoading(false)
    }
  }

  const canCreate = subscriptionName.trim() && (
    selectedMode === 'oauth'
    || (selectedMode === 'api-key' && apiKey.trim())
    || (selectedMode === 'manual' && webhookUrl.trim())
  )

  if (!selectedMode) {
    return (
      <Modal
        isShow
        onClose={onCancel}
        className='!max-w-[520px] !p-0'
      >
        <div className='flex items-center justify-between p-6 pb-4'>
          <h3 className='text-lg font-semibold text-text-primary'>
            {t('plugin.detailPanel.createSubscription')}
          </h3>
          <Button variant='ghost' size='small' onClick={onCancel}>
            <RiCloseLine className='h-4 w-4' />
          </Button>
        </div>

        <div className='px-6 pb-2'>
          <p className='system-sm-regular mb-4 text-text-secondary'>
            {t('plugin.detailPanel.createSubscriptionDesc')}
          </p>
        </div>

        <div className='px-6 pb-6'>
          <div className='space-y-3'>
            <button
              onClick={() => handleModeSelect('api-key')}
              className='flex w-full items-center gap-3 rounded-lg border border-components-panel-border p-4 text-left transition-colors hover:bg-background-default-hover'
            >
              <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-background-default-subtle'>
                <RiKeyLine className='h-5 w-5 text-text-warning' />
              </div>
              <div className='flex-1'>
                <div className='system-sm-semibold text-text-primary'>
                  {t('plugin.detailPanel.createViaApiKey')}
                </div>
                <div className='system-xs-regular text-text-tertiary'>
                  {t('plugin.detailPanel.createViaApiKeyDesc')}
                </div>
              </div>
            </button>

            <button
              onClick={() => handleModeSelect('oauth')}
              className='flex w-full items-center gap-3 rounded-lg border border-components-panel-border p-4 text-left transition-colors hover:bg-background-default-hover'
            >
              <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-background-default-subtle'>
                <RiUserLine className='h-5 w-5 text-text-accent' />
              </div>
              <div className='flex-1'>
                <div className='system-sm-semibold text-text-primary'>
                  {t('plugin.detailPanel.createViaOAuth')}
                </div>
                <div className='system-xs-regular text-text-tertiary'>
                  {t('plugin.detailPanel.createViaOAuthDesc')}
                </div>
              </div>
            </button>

            <button
              onClick={() => handleModeSelect('manual')}
              className='flex w-full items-center gap-3 rounded-lg border border-components-panel-border p-4 text-left transition-colors hover:bg-background-default-hover'
            >
              <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-background-default-subtle'>
                <RiEditLine className='h-5 w-5 text-text-secondary' />
              </div>
              <div className='flex-1'>
                <div className='system-sm-semibold text-text-primary'>
                  {t('plugin.detailPanel.createManual')}
                </div>
                <div className='system-xs-regular text-text-tertiary'>
                  {t('plugin.detailPanel.createManualDesc')}
                </div>
              </div>
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      isShow
      onClose={onCancel}
      className='!max-w-[520px] !p-0'
    >
      <div className='flex items-center justify-between p-6 pb-4'>
        <div className='flex items-center gap-3'>
          <Button variant='ghost' size='small' onClick={handleBack}>
            ←
          </Button>
          <h3 className='text-lg font-semibold text-text-primary'>
            {selectedMode === 'api-key' && t('plugin.detailPanel.createViaApiKey')}
            {selectedMode === 'oauth' && t('plugin.detailPanel.createViaOAuth')}
            {selectedMode === 'manual' && t('plugin.detailPanel.createManual')}
          </h3>
        </div>
        <Button variant='ghost' size='small' onClick={onCancel}>
          <RiCloseLine className='h-4 w-4' />
        </Button>
      </div>

      <div className='px-6 pb-6'>
        <div className='space-y-4'>
          <div>
            <label className='system-sm-medium mb-2 block text-text-primary'>
              {t('plugin.detailPanel.subscriptionName')}
            </label>
            <Input
              value={subscriptionName}
              onChange={e => setSubscriptionName(e.target.value)}
              placeholder={t('plugin.detailPanel.subscriptionNamePlaceholder')}
              className='w-full'
            />
          </div>

          {selectedMode === 'api-key' && (
            <div>
              <label className='system-sm-medium mb-2 block text-text-primary'>
                {t('plugin.detailPanel.apiKey')}
              </label>
              <Input
                type='password'
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={t('plugin.detailPanel.apiKeyPlaceholder')}
                className='w-full'
              />
            </div>
          )}

          {selectedMode === 'oauth' && (
            <div className='rounded-lg bg-background-section p-4'>
              <p className='system-sm-regular text-text-secondary'>
                {t('plugin.detailPanel.oauthCreateNote')}
              </p>
            </div>
          )}

          {selectedMode === 'manual' && (
            <div>
              <label className='system-sm-medium mb-2 block text-text-primary'>
                {t('plugin.detailPanel.webhookUrl')}
              </label>
              <Input
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                placeholder={t('plugin.detailPanel.webhookUrlPlaceholder')}
                className='w-full'
              />
            </div>
          )}
        </div>

        <div className='mt-6 flex justify-end gap-2'>
          <Button variant='secondary' onClick={onCancel}>
            {t('common.operation.cancel')}
          </Button>
          <Button
            variant='primary'
            onClick={handleCreate}
            disabled={!canCreate}
            loading={isLoading}
          >
            {t('common.operation.create')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default SubscriptionModal
