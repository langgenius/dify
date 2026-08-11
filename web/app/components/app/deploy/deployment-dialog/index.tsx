'use client'

import type { DeploymentVersion } from '../version'
import type { DeploymentDialogRequest } from './types'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { DeploymentConfiguration } from './deployment-configuration'
import { VersionSelection } from './version-selection'

type DeploymentDialogProps = {
  appId: string
  request?: DeploymentDialogRequest
  onClose: () => void
}

function DeploymentDialogSession({
  appId,
  request,
  onClose,
}: {
  appId: string
  request: DeploymentDialogRequest
  onClose: () => void
}) {
  const [selectedVersion, setSelectedVersion] = useState<DeploymentVersion | undefined>(() =>
    'initialVersion' in request ? request.initialVersion : undefined,
  )

  return (
    <DialogContent className="flex max-h-[min(44rem,calc(100dvh-32px))] min-h-0 w-120 max-w-[calc(100vw-32px)] flex-col overflow-hidden p-0">
      {selectedVersion ? (
        <DeploymentConfiguration
          appId={appId}
          key={selectedVersion.id}
          request={request}
          version={selectedVersion}
          onBack={request.kind === 'redeploy' ? undefined : () => setSelectedVersion(undefined)}
          onClose={onClose}
        />
      ) : (
        <VersionSelection appId={appId} request={request} onSelect={setSelectedVersion} />
      )}
    </DialogContent>
  )
}

export function DeploymentDialog({ appId, request, onClose }: DeploymentDialogProps) {
  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && onClose()}>
      {request && (
        <DeploymentDialogSession
          appId={appId}
          key={`${request.kind}-${request.environmentId}-${request.currentVersionId ?? 'none'}-${
            'initialVersion' in request ? request.initialVersion.name : 'none'
          }`}
          request={request}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}
