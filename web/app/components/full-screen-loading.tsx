import Loading from './base/loading'

export function FullScreenLoading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background-body">
      <Loading />
    </div>
  )
}
