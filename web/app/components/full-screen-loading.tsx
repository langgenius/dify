import Loading from './base/loading'

export function FullScreenLoading() {
  return (
    <div className="flex min-h-dvh w-full flex-1 items-center justify-center bg-background-body">
      <Loading />
    </div>
  )
}
