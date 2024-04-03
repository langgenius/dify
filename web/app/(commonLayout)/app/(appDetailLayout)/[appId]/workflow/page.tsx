import Workflow from '@/app/components/workflow'

const Page = async ({
  params: { appId },
}: any) => {
  return (
    <div className='w-full h-full overflow-x-auto'>
      <Workflow appId={appId} />
    </div>
  )
}
export default Page
