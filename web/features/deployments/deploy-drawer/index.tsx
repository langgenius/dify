'use client'

import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  closeDeployDrawerAtom,
  deployDrawerAppInstanceIdAtom,
  deployDrawerEnvironmentIdAtom,
  deployDrawerOpenAtom,
  deployDrawerReleaseIdAtom,
} from './state'
import { DeployForm } from './ui/form'

export function DeployDrawer() {
  const { t } = useTranslation('deployments')
  const open = useAtomValue(deployDrawerOpenAtom)
  const drawerAppInstanceId = useAtomValue(deployDrawerAppInstanceIdAtom)
  const drawerEnvironmentId = useAtomValue(deployDrawerEnvironmentIdAtom)
  const drawerReleaseId = useAtomValue(deployDrawerReleaseIdAtom)
  const closeDeployDrawer = useSetAtom(closeDeployDrawerAtom)
  const formKey = `${drawerAppInstanceId ?? 'none'}-${drawerEnvironmentId ?? 'any'}-${drawerReleaseId ?? 'new'}-${open ? '1' : '0'}`

  return (
    <Drawer
      open={open}
      modal
      swipeDirection="right"
      onOpenChange={next => !next && closeDeployDrawer()}
    >
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:w-[640px] data-[swipe-direction=right]:max-w-[calc(100vw-1rem)]">
            <DrawerCloseButton
              aria-label={t('deployDrawer.close')}
              className="absolute top-4 right-5 size-6 rounded-md"
            />
            <DrawerContent className="flex min-h-0 flex-1 flex-col bg-components-panel-bg p-0 pb-0">
              {!drawerAppInstanceId
                ? <div className="p-6 text-text-tertiary">{t('deployDrawer.notFound')}</div>
                : (
                    <DeployForm
                      key={formKey}
                      appInstanceId={drawerAppInstanceId}
                      lockedEnvId={drawerEnvironmentId}
                      presetReleaseId={drawerReleaseId}
                    />
                  )}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
