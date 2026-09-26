import WorkflowApp from '@/app/components/workflow-app'

const Page = async ({ params }: { params: Promise<{ appId: string }> }) => {
  const { appId } = await params
  return (
    <div className="size-full overflow-x-auto">
      <WorkflowApp appId={appId} />
    </div>
  )
}
export default Page
