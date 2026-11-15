import { buildInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import { redirect } from '@/next/navigation'

export type IInstalledAppProps = {
  params?: Promise<{
    appId: string
  }>
}

// Using Next.js page convention for async server components
async function InstalledApp({ params }: IInstalledAppProps) {
  const { appId } = await (params ?? Promise.reject(new Error('Missing params')))
  redirect(buildInstalledAppPath(appId))
}

export default InstalledApp
