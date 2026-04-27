import type { Locale } from '@/i18n-config'
import AppAccessConfigPage from '@/app/components/app/access-config'

export type AccessConfigPageProps = {
  params: Promise<{ locale: Locale, appId: string }>
}

const AccessConfig = async (props: AccessConfigPageProps) => {
  const params = await props.params

  const { appId } = params

  return <AppAccessConfigPage appId={appId} />
}

export default AccessConfig
