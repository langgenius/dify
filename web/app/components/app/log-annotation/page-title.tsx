import type { ReactNode } from 'react'

type PageTitleProps = {
  title: ReactNode
  description: ReactNode
  learnMoreHref?: string
  learnMoreLabel?: ReactNode
}

const PageTitle = ({
  title,
  description,
  learnMoreHref,
  learnMoreLabel,
}: PageTitleProps) => {
  const showLearnMore = !!learnMoreHref && learnMoreLabel !== undefined && learnMoreLabel !== null

  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <div className="flex h-6 items-center">
        <h1 className="title-2xl-semi-bold text-text-primary">{title}</h1>
      </div>
      <div className="flex min-w-0 items-start gap-0.5 system-xs-regular text-text-tertiary">
        <p className="min-w-0 truncate">{description}</p>
        {showLearnMore && (
          <a
            href={learnMoreHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center text-text-accent hover:underline"
          >
            <span>{learnMoreLabel}</span>
            <span className="i-ri-external-link-line size-3" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  )
}

export default PageTitle
