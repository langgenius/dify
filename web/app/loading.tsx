import Loading from '@/app/components/base/loading'

export default function RootLoading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background-body">
      <Loading />
    </div>
  )
}
