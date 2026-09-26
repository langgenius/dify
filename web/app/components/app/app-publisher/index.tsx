import type { AppPublisherProps } from './types'
import { useAtom, useAtomValue } from 'jotai'
import { useParams } from '@/next/navigation'
import { PublisherContent } from './publisher-content'
import {
  appPublisherCapabilitiesAtom,
  appPublisherEnvironmentQueryEnabledAtom,
  appPublisherOpenAtom,
  AppPublisherStateBoundary,
} from './state'

function AppPublisherView(props: AppPublisherProps) {
  const [open, setOpen] = useAtom(appPublisherOpenAtom)
  const { canViewAccessPoint } = useAtomValue(appPublisherCapabilitiesAtom)
  const supportsMultiEnvironment = useAtomValue(appPublisherEnvironmentQueryEnabledAtom)

  return (
    <PublisherContent
      {...props}
      canViewAccessPoint={canViewAccessPoint}
      open={open}
      supportsMultiEnvironment={supportsMultiEnvironment}
      onOpenStateChange={setOpen}
    />
  )
}

export function AppPublisher(props: AppPublisherProps) {
  const { appId } = useParams<{ appId: string }>()
  return (
    <AppPublisherStateBoundary appId={appId}>
      <AppPublisherView {...props} />
    </AppPublisherStateBoundary>
  )
}
