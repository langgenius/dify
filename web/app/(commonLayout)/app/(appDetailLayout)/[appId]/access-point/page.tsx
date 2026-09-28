import AccessPoint from '@/app/components/app/access-point'

type AppAccessPointPageProps = {
  params: Promise<{ appId: string }>
}

export default async function AppAccessPointPage({ params }: AppAccessPointPageProps) {
  const { appId } = await params

  return <AccessPoint appId={appId} />
}
