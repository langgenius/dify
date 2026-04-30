type SelectorFooterProps = {
  title: string
  description: string
  disabled?: boolean
  onClick: () => void
}

const SelectorFooter = ({
  title,
  description,
  disabled = false,
  onClick,
}: SelectorFooterProps) => {
  return (
    <button
      type="button"
      disabled={disabled}
      className="relative flex items-center gap-3 overflow-hidden border-t border-divider-subtle bg-background-default-subtle px-4 py-5 text-left enabled:hover:bg-state-base-hover-alt disabled:cursor-not-allowed disabled:opacity-60"
      onClick={onClick}
    >
      <div className="absolute -top-6 -left-6 h-28 w-28 rounded-full bg-util-colors-indigo-indigo-100 opacity-50 blur-2xl" />
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-[0px_3px_10px_-2px_rgba(9,9,11,0.08),0px_2px_4px_-2px_rgba(9,9,11,0.06)]">
        <span aria-hidden="true" className="i-ri-add-line h-[18px] w-[18px] text-text-tertiary" />
      </div>
      <div className="relative min-w-0">
        <div className="system-sm-semibold text-text-secondary">{title}</div>
        <div className="mt-0.5 system-xs-regular text-text-tertiary">{description}</div>
      </div>
    </button>
  )
}

export default SelectorFooter
