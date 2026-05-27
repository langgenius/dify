import Loading from '@/app/components/base/loading'

export default function CommonLayoutLoading() {
  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center bg-background-body">
      <Loading />
    </div>
  )
}
