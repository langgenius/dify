'use client'
import type { FC } from 'react'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useDeploymentsStore } from './store'
import { useSourceApps } from './use-source-apps'

const InfoRow: FC<{ label: string, value: string }> = ({ label, value }) => {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="system-xs-medium-uppercase text-text-tertiary">{label}</span>
      <span className="system-sm-medium text-text-primary">{value}</span>
    </div>
  )
}

const RollbackModal: FC = () => {
  const { t } = useTranslation('deployments')
  const modal = useDeploymentsStore(state => state.rollbackModal)
  const deployments = useDeploymentsStore(state => state.deployments)
  const instances = useDeploymentsStore(state => state.instances)
  const releases = useDeploymentsStore(state => state.releases)
  const environments = useDeploymentsStore(state => state.environments)
  const closeRollbackModal = useDeploymentsStore(state => state.closeRollbackModal)
  const rollbackDeployment = useDeploymentsStore(state => state.rollbackDeployment)
  const { appMap } = useSourceApps()

  const deployment = deployments.find(d => d.id === modal.deploymentId)
  const targetRelease = releases.find(r => r.id === modal.targetReleaseId)
  const currentRelease = releases.find(r => r.id === deployment?.activeReleaseId)
  const environment = environments.find(env => env.id === deployment?.environmentId)
  const instance = instances.find(i => i.id === deployment?.instanceId)
  const app = instance ? appMap.get(instance.appId) : undefined

  const confirm = () => {
    if (!modal.deploymentId || !modal.targetReleaseId)
      return
    rollbackDeployment(modal.deploymentId, modal.targetReleaseId)
  }

  return (
    <AlertDialog
      open={modal.open}
      onOpenChange={next => !next && closeRollbackModal()}
    >
      <AlertDialogContent className="w-[520px]">
        <div className="flex flex-col gap-3 px-6 pt-6 pb-2">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t('rollback.title', { release: targetRelease?.id ?? '-' })}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-md-regular text-text-tertiary">
            {t('rollback.description')}
          </AlertDialogDescription>

          <div className="mt-2 flex flex-col gap-2 rounded-lg border border-components-panel-border bg-components-panel-bg-blur p-3">
            <InfoRow label={t('rollback.instance')} value={instance?.name ?? '-'} />
            <InfoRow label={t('rollback.sourceApp')} value={app?.name ?? '-'} />
            <InfoRow label={t('rollback.environment')} value={environment?.name ?? '-'} />
            <InfoRow
              label={t('rollback.currentRelease')}
              value={currentRelease ? `${currentRelease.id} / ${currentRelease.gateCommitId}` : '-'}
            />
            <InfoRow
              label={t('rollback.rollbackTo')}
              value={targetRelease ? `${targetRelease.id} / ${targetRelease.gateCommitId}` : '-'}
            />
          </div>

          <div className="rounded-lg border border-dashed border-util-colors-red-red-200 bg-util-colors-red-red-50 p-3">
            <div className="title-sm-semi-bold text-util-colors-red-red-700">
              {t('rollback.impactingTitle')}
            </div>
            <p className="mt-1 system-xs-regular text-util-colors-red-red-600">
              {t('rollback.impactingBody')}
            </p>
          </div>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton variant="secondary">
            {t('rollback.cancel')}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton onClick={confirm}>
            {t('rollback.confirm')}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default RollbackModal
