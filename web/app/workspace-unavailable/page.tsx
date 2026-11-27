import type { Metadata } from '@/next'
import { CommonLayoutHydrationBoundary } from '@/app/(commonLayout)/hydration-boundary'
import { SettingsModal } from '@/app/components/header/account-setting/settings-modal'
import AccountSection from '@/app/components/main-nav/components/account-section'
import { getRouteMetadata } from '@/app/route-metadata'
import { WorkspaceAccessRecovery } from './workspace-access-recovery'

export async function generateMetadata(): Promise<Metadata> {
  const metadata = await getRouteMetadata('navigation', ($) => $['workspaceUnavailable.title'])

  return { ...metadata, robots: { index: false } }
}

export default function WorkspaceUnavailablePage() {
  return (
    <CommonLayoutHydrationBoundary>
      <div className="grid min-h-dvh grid-rows-[1fr_auto_1fr] bg-neutral-50 dark:bg-background-body">
        <WorkspaceAccessRecovery />
        <footer className="row-start-3 w-60 max-w-full self-end py-3 ps-3 pe-1">
          <AccountSection />
        </footer>
      </div>
      <SettingsModal />
    </CommonLayoutHydrationBoundary>
  )
}
