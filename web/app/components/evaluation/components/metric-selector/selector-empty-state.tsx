type SelectorEmptyStateProps = {
  message: string
}

const EmptySearchStateIcon = () => {
  return (
    <div className="relative h-8 w-8 text-text-quaternary">
      <span aria-hidden="true" className="i-ri-search-line absolute bottom-0 right-0 h-6 w-6" />
      <span aria-hidden="true" className="absolute left-0 top-[9px] h-[2px] w-[7px] rounded-full bg-current opacity-80" />
      <span aria-hidden="true" className="absolute left-0 top-[16px] h-[2px] w-[4px] rounded-full bg-current opacity-80" />
    </div>
  )
}

const SelectorEmptyState = ({
  message,
}: SelectorEmptyStateProps) => {
  return (
    <div className="flex h-full min-h-[524px] flex-col items-center justify-center gap-2 px-4 pb-20 text-center">
      <EmptySearchStateIcon />
      <div className="text-text-secondary system-sm-regular">{message}</div>
    </div>
  )
}

export default SelectorEmptyState
