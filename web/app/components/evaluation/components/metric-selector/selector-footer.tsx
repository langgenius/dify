import { buttonVariants } from '@langgenius/dify-ui/button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import Link from '@/next/link'

type SelectorFooterProps = {
  title: string
  description: string
  infoLabel: string
  infoDescription: string
  createLabel: string
  createHref?: string
  disabled?: boolean
  onClick: () => void
}

const SelectorFooter = ({
  title,
  description,
  infoLabel,
  infoDescription,
  createLabel,
  createHref,
  disabled = false,
  onClick,
}: SelectorFooterProps) => {
  return (
    <div className="relative shrink-0 overflow-hidden border-t border-divider-subtle bg-background-default-subtle px-4 py-4">
      <div className="pointer-events-none absolute -start-6 -top-6 size-28 rounded-full bg-util-colors-indigo-indigo-100 opacity-50 blur-2xl" />
      <div className="relative flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2">
        <button
          type="button"
          disabled={disabled}
          className="flex min-w-32 items-center gap-3 rounded-md text-start focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onClick}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-[0px_3px_10px_-2px_rgba(9,9,11,0.08),0px_2px_4px_-2px_rgba(9,9,11,0.06)]">
            <span aria-hidden="true" className="i-ri-add-line size-[18px] text-text-tertiary" />
          </span>
          <span className="min-w-0 system-sm-semibold wrap-break-word text-text-secondary">
            {title}
          </span>
        </button>
        <Infotip>
          <InfotipTrigger aria-label={infoLabel} />
          <InfotipContent aria-label={infoLabel} className="max-w-72">
            {infoDescription}
          </InfotipContent>
        </Infotip>
        {createHref && (
          <Link
            href={createHref}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            className={buttonVariants({
              variant: 'secondary-accent',
              size: 'small',
              className: 'ms-auto shrink-0',
            })}
          >
            {createLabel}
            <span aria-hidden="true" className="i-ri-external-link-line size-3" />
          </Link>
        )}
      </div>
      <p className="relative mt-0.5 ps-11 system-xs-regular text-text-tertiary">{description}</p>
    </div>
  )
}

export default SelectorFooter
