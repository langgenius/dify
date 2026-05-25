'use client'

import { Dialog, DialogCloseButton, DialogContent } from '@langgenius/dify-ui/dialog'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  closeDeployDrawerAtom,
  deployDrawerAppInstanceIdAtom,
  deployDrawerEnvironmentIdAtom,
  deployDrawerOpenAtom,
  deployDrawerReleaseIdAtom,
} from '../store'
import { DeployForm } from './deploy-drawer/form'

export function DeployDrawer() {
  const { t } = useTranslation('deployments')
  const open = useAtomValue(deployDrawerOpenAtom)
  const drawerAppInstanceId = useAtomValue(deployDrawerAppInstanceIdAtom)
  const drawerEnvironmentId = useAtomValue(deployDrawerEnvironmentIdAtom)
  const drawerReleaseId = useAtomValue(deployDrawerReleaseIdAtom)
  const closeDeployDrawer = useSetAtom(closeDeployDrawerAtom)
  const formKey = `${drawerAppInstanceId ?? 'none'}-${drawerEnvironmentId ?? 'any'}-${drawerReleaseId ?? 'new'}-${open ? '1' : '0'}`

  return (
    <Dialog
      open={open}
      onOpenChange={next => !next && closeDeployDrawer()}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-140 max-w-[90vw] overflow-hidden">
        <DialogCloseButton />
        {!drawerAppInstanceId
          ? <div className="p-4 text-text-tertiary">{t('deployDrawer.notFound')}</div>
          : (
              <DeployForm
                key={formKey}
                appInstanceId={drawerAppInstanceId}
                lockedEnvId={drawerEnvironmentId}
                presetReleaseId={drawerReleaseId}
              />
            )}
      </DialogContent>
    </Dialog>
  )
}
