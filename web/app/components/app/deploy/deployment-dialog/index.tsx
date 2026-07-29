'use client'

import type { MockVersion } from '../mock-data'
import type { DeploymentDialogRequest } from './types'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { DeploymentConfiguration } from './deployment-configuration'
import { VersionSelection } from './version-selection'

type DeploymentDialogProps = {
  request?: DeploymentDialogRequest
  onClose: () => void
}

function DeploymentDialogSession({
  request,
  onClose,
}: {
  request: DeploymentDialogRequest
  onClose: () => void
}) {
  const [selectedVersion, setSelectedVersion] = useState<MockVersion>()

  return (
    <DialogContent className="flex max-h-[calc(100dvh-32px)] w-120 max-w-[calc(100vw-32px)] flex-col overflow-hidden p-0">
      {selectedVersion ? (
        <DeploymentConfiguration
          key={selectedVersion.name}
          request={request}
          version={selectedVersion}
          onBack={() => setSelectedVersion(undefined)}
          onClose={onClose}
        />
      ) : (
        <VersionSelection request={request} onSelect={setSelectedVersion} />
      )}
    </DialogContent>
  )
}

export function DeploymentDialog({ request, onClose }: DeploymentDialogProps) {
  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && onClose()}>
      {request && (
        <DeploymentDialogSession
          key={`${request.kind}-${request.environment}-${request.currentVersion ?? 'none'}`}
          request={request}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}
