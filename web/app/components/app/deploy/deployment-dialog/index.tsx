'use client'

import type { RefObject } from 'react'
import type { DeploymentDialogRequest } from '../types'
import type { DeploymentVersion } from '../utils/version'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useLayoutEffect, useRef, useState } from 'react'
import { DeploymentConfiguration } from '../shared/deployment-configuration'
import { VersionSelection } from '../shared/version-selection'

type DeploymentDialogProps = {
  appId: string
  open: boolean
  finalFocus: RefObject<HTMLElement | null>
  request: DeploymentDialogRequest
  onClose: () => void
}

function DeploymentDialogSession({
  appId,
  request,
  titleRef,
  onClose,
}: {
  appId: string
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

export function DeploymentDialog({
  appId,
  finalFocus,
  open,
  request,
  onClose,
}: DeploymentDialogProps) {
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        initialFocus={titleRef}
        finalFocus={finalFocus}
        className="max-h-[min(44rem,calc(100dvh-32px))]"
      >
        <DeploymentDialogSession
          titleRef={titleRef}
          appId={appId}
          key={`${request.kind}-${request.environmentId}-${request.currentVersionId ?? 'none'}-${
            'initialVersion' in request ? request.initialVersion.name : 'none'
          }`}
          request={request}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}
