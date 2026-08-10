const skeletonClassName = 'rounded bg-text-quaternary opacity-20'

export const InstalledAppPaginationSkeleton = () => (
  <div
    aria-hidden
    className="flex h-8 animate-pulse items-center gap-2 px-2 py-0.5 motion-reduce:animate-none"
  >
    <div className={`${skeletonClassName} size-5 shrink-0 rounded-md`} />
    <div className={`${skeletonClassName} h-3 w-24`} />
  </div>
)
