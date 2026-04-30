type SelectorEmptyStateProps = {
  message: string
}

const EmptySearchStateIcon = () => {
  return (
    <div className="relative h-8 w-8 text-text-quaternary">
      <span aria-hidden="true" className="absolute right-0 bottom-0 i-ri-search-line h-6 w-6" />
      <span aria-hidden="true" className="absolute top-[9px] left-0 h-[2px] w-[7px] rounded-full bg-current opacity-80" />
      <span aria-hidden="true" className="absolute top-[16px] left-0 h-[2px] w-[4px] rounded-full bg-current opacity-80" />
    </div>
  )
}

const SelectorEmptyState = ({
  message,
}: SelectorEmptyStateProps) => {
  return (
    <div className="flex h-full min-h-[524px] flex-col items-center justify-center gap-2 px-4 pb-20 text-center">
      <EmptySearchStateIcon />
      <div className="system-sm-regular text-text-secondary">{message}</div>
    </div>
  )
}

export default SelectorEmptyState
