type TagTriggerContentProps = {
  tags: string[]
  emptyLabel: string
}

export const TagTriggerContent = ({ tags, emptyLabel }: TagTriggerContentProps) => {
  return (
    <span aria-hidden="true" className="flex w-full min-w-0 items-center gap-1">
      {!tags.length ? (
        <span className="flex max-w-full min-w-0 items-center gap-x-0.5 rounded-[5px] border border-dashed border-divider-deep bg-components-badge-bg-dimm px-1.25 py-0.75">
          <span className="i-ri-price-tag-3-line size-3 shrink-0 text-text-quaternary" />
          <span className="truncate system-2xs-medium-uppercase text-text-tertiary">
            {emptyLabel}
          </span>
        </span>
      ) : (
        <>
          {tags.map((content) => (
            <span
              key={content}
              className="flex max-w-30 min-w-0 shrink-0 items-center gap-x-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.25 py-0.75"
            >
              <span className="i-ri-price-tag-3-line size-3 shrink-0 text-text-quaternary" />
              <span className="truncate system-2xs-medium-uppercase text-text-tertiary">
                {content}
              </span>
            </span>
          ))}
        </>
      )}
    </span>
  )
}
