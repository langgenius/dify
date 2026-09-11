'use client'
import type { DeploymentDialogRequest } from '../../types'
import type { DeploymentVersion } from '../../utils/version'
import { Button } from '@langgenius/dify-ui/button'
import { DialogClose, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { VersionList } from './version-list'

function versionSelectionTitle(request: DeploymentDialogRequest, deployTo: string, change: string) {
  return request.kind === 'deploy' ? deployTo : `${change} · ${request.environment}`
}

export function VersionSelection({
  appId,
  request,
  onSelect,
}: {
  appId: string
  request: DeploymentDialogRequest
  onSelect: (version: DeploymentVersion) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const title = versionSelectionTitle(
    request,
    t(($) => $['versions.deployTo'], { name: request.environment }),
    t(($) => $['studio.changeVersion']),
  )

  return (
    <>
      <DialogClose
        render={
          <IconButton
            aria-label={tCommon(($) => $['operation.close'])}
            size="lg"
            className="absolute top-5 right-5"
            type="button"
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </IconButton>
        }
      />
      <header className="shrink-0 px-6 pt-6 pr-14 pb-3">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">{title}</DialogTitle>
        <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['studio.chooseVersionToDeploy'])}
        </DialogDescription>
      </header>
      <VersionList
        className="px-4 pt-2 pb-4"
        currentVersionId={request.currentVersionId}
        label={title}
        publishHref={`/app/${appId}/workflow`}
        onSelect={onSelect}
      />
    </>
  )
}

export function EmbeddedVersionSelection({
  disabled,
  request,
  onBack,
  onSelect,
}: {
  disabled: boolean
  request: DeploymentDialogRequest
  onBack: () => void
  onSelect: (version: DeploymentVersion) => void
}) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const title = versionSelectionTitle(
    request,
    t(($) => $['versions.deployTo'], { name: request.environment }),
    t(($) => $['studio.changeVersion']),
  )

  return (
    <div className="flex h-133 max-h-[calc(100dvh-32px)] min-h-0 flex-none flex-col">
      <header className="shrink-0 px-3 pt-3.5 pb-1">
        <Button
          type="button"
          size="small"
          variant="ghost-accent"
          className="-ml-1 h-6 gap-1 px-1 system-xs-semibold-uppercase"
          onClick={onBack}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-4" />
          {tCommon(($) => $['operation.back'])}
        </Button>
        <h2 className="mt-0.5 px-1 system-xl-semibold text-text-primary">{title}</h2>
        <p className="mt-0.5 px-1 system-xs-regular text-text-tertiary">
          {t(($) => $['studio.chooseVersionToDeploy'])}
        </p>
      </header>
      <VersionList
        className="p-2"
        currentVersionId={request.currentVersionId}
        disabled={disabled}
        label={title}
        onSelect={onSelect}
      />
    </div>
  )
}
