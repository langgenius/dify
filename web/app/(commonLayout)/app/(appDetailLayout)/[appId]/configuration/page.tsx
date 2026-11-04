import Configuration from '@/app/components/app/configuration'

const IConfiguration = async ({ params }: { params: Promise<{ appId: string }> }) => {
  const { appId } = await params
  return <Configuration key={appId} />
}

export default IConfiguration
