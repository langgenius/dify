'use client'
import type { FC } from 'react'
import type { Instance } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { useDeploymentsStore } from '../store'

type SettingsTabProps = {
  instanceId: string
}

type SettingsFormProps = {
  instance: Instance
  hasDeployments: boolean
}

const SettingsForm: FC<SettingsFormProps> = ({ instance, hasDeployments }) => {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const updateInstance = useDeploymentsStore(state => state.updateInstance)
  const deleteInstance = useDeploymentsStore(state => state.deleteInstance)

  const [name, setName] = useState(instance.name)
  const [description, setDescription] = useState(instance.description ?? '')

  const dirty = name !== instance.name || description !== (instance.description ?? '')

  const handleSave = () => {
    if (!name.trim())
      return
    updateInstance(instance.id, {
      name: name.trim(),
      description: description.trim() || undefined,
    })
    toast.success(t('settings.updated'))
  }

  const handleReset = () => {
    setName(instance.name)
    setDescription(instance.description ?? '')
  }

  const handleDelete = () => {
    if (hasDeployments) {
      toast.error(t('settings.undeployFirst'))
      return
    }
    deleteInstance(instance.id)
    router.push('/deployments')
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-5 p-6">
      <div className="flex flex-col gap-3 rounded-xl border border-components-panel-border bg-components-panel-bg p-4">
        <div className="system-sm-semibold text-text-primary">{t('settings.general')}</div>
        <div className="flex flex-col gap-2">
          <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="settings-name">
            {t('settings.name')}
          </label>
          <input
            id="settings-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="flex h-8 items-center rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal px-3 text-[13px] font-medium text-text-secondary outline-hidden placeholder:text-text-quaternary"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="settings-desc">
            {t('settings.description')}
          </label>
          <textarea
            id="settings-desc"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="min-h-[96px] rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal px-3 py-2 text-[13px] text-text-secondary outline-hidden placeholder:text-text-quaternary"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={!dirty} onClick={handleReset}>
            {t('settings.reset')}
          </Button>
          <Button variant="primary" disabled={!dirty || !name.trim()} onClick={handleSave}>
            {t('settings.save')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-util-colors-red-red-200 bg-util-colors-red-red-50 p-4">
        <div className="system-sm-semibold text-util-colors-red-red-700">{t('settings.danger')}</div>
        <div className="system-xs-regular text-util-colors-red-red-600">
          {t('settings.dangerDesc')}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="system-xs-regular text-text-tertiary">
            {hasDeployments
              ? t('settings.undeployFirst')
              : t('settings.safeToDelete')}
          </div>
          <Button
            variant="primary"
            tone="destructive"
            disabled={hasDeployments}
            onClick={handleDelete}
          >
            {t('settings.delete')}
          </Button>
        </div>
      </div>
    </div>
  )
}

const SettingsTab: FC<SettingsTabProps> = ({ instanceId }) => {
  const instances = useDeploymentsStore(state => state.instances)
  const deployments = useDeploymentsStore(state => state.deployments)

  const instance = instances.find(i => i.id === instanceId)

  if (!instance)
    return null

  const hasDeployments = deployments.some(d => d.instanceId === instanceId)
  const formKey = `${instance.id}-${instance.name}-${instance.description ?? ''}`

  return <SettingsForm key={formKey} instance={instance} hasDeployments={hasDeployments} />
}

export default SettingsTab
