'use client'

import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import type { RefObject } from 'react'
import type { DeploymentDialogRequest } from '../types'
import type { DeploymentVersion } from '../utils/version'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogContent } from '@langgenius/dify-ui/dialog'
import { useLayoutEffect, useRef, useState } from 'react'
import { DeploymentConfiguration } from '../shared/deployment-configuration'
import { VersionSelection } from '../shared/version-selection'

type DeploymentDialogContentProps = {
  appId: string
  request: DeploymentDialogRequest
  onClose: () => void
} & Pick<DialogContentProps, 'finalFocus'>

function DeploymentDialogSession({
  appId,
  request,
  titleRef,
  onClose,
}: Omit<DeploymentDialogContentProps, 'finalFocus'> & {
  titleRef: RefObject<HTMLHeadingElement | null>
}) {
  const [selectedVersion, setSelectedVersion] = useState<DeploymentVersion | undefined>(() =>
    'initialVersion' in request ? request.initialVersion : undefined,
  )
  const previousVersionRef = useRef(selectedVersion)
  useLayoutEffect(() => {
    // DialogContent owns opening focus; only move it when the wizard changes steps.
    if (previousVersionRef.current !== selectedVersion) titleRef.current?.focus()
    previousVersionRef.current = selectedVersion
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

export function DeploymentDialogContent({
  finalFocus,
  ...sessionProps
}: DeploymentDialogContentProps) {
  const titleRef = useRef<HTMLHeadingElement | null>(null)

  return (
    <DialogContent
      initialFocus={titleRef}
      finalFocus={finalFocus}
      className="max-h-[min(44rem,calc(100dvh-32px))]"
    >
      <DeploymentDialogSession {...sessionProps} titleRef={titleRef} />
    </DialogContent>
  )
}
