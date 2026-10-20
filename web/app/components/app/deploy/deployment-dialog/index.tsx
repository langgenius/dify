'use client'

import type { RefObject } from 'react'
import type { DeploymentDialogPayload, DeploymentDialogRequest } from '../types'
import type { DeploymentVersion } from '../utils/version'
import { cn } from '@langgenius/dify-ui/cn'
import { useLayoutEffect, useState } from 'react'
import { DeploymentConfiguration } from '../shared/deployment-configuration'
import { VersionSelection } from '../shared/version-selection'

export function DeploymentDialogSession({
  appId,
  menuActionsRef,
  request,
  titleRef,
  onClose,
}: {
  appId: string
  menuActionsRef?: DeploymentDialogPayload['menuActionsRef']
  request: DeploymentDialogRequest
  titleRef: RefObject<HTMLHeadingElement | null>
  onClose: () => void
}) {
  const [selectedVersion, setSelectedVersion] = useState<DeploymentVersion | undefined>(() =>
    'initialVersion' in request ? request.initialVersion : undefined,
  )
  useLayoutEffect(() => {
    titleRef.current?.focus()
  }, [selectedVersion, titleRef])
  // Keep menu triggers mounted until Base UI has forwarded their payload and focus has moved.
  useLayoutEffect(() => {
    menuActionsRef?.current?.close()
  }, [menuActionsRef])

  return (
    <div
      className={cn(
        'flex flex-col',
        selectedVersion ? 'shrink-0' : 'h-[min(44rem,calc(100dvh-32px))] min-h-0 flex-1',
      )}
    >
      {selectedVersion ? (
        <DeploymentConfiguration
          titleRef={titleRef}
          appId={appId}
          key={selectedVersion.id}
          request={request}
          version={selectedVersion}
          onBack={request.kind === 'redeploy' ? undefined : () => setSelectedVersion(undefined)}
          onClose={onClose}
        />
      ) : (
        <VersionSelection
          titleRef={titleRef}
          appId={appId}
          request={request}
          onSelect={setSelectedVersion}
        />
      )}
    </div>
  )
}
