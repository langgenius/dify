import type { ReactNode } from 'react'
import PictureFrame from './assets/picture-frame.svg'

type TipCardProps = {
  title: string
  description: string
  dismissLabel: string
  onDismiss: () => void
}

const renderDescription = (description: string): ReactNode => {
  const visionLabel = 'Vision'
  const [beforeVision, afterVision] = description.split(visionLabel)

  if (afterVision === undefined) return description

  return (
    <>
      {beforeVision}
      <span className="font-semibold text-text-primary">{visionLabel}</span>
      {afterVision}
    </>
  )
}

export const TipCard = ({ title, description, dismissLabel, onDismiss }: TipCardProps) => {
  return (
    <div className="relative flex gap-3 overflow-hidden rounded-xl border border-divider-regular bg-linear-to-b from-components-chat-input-audio-bg-alt to-components-chat-input-audio-bg py-3 pr-0.75 pl-3 shadow-xs">
      <div className="relative size-9 shrink-0">
        <img
          src={PictureFrame.src}
          alt=""
          className="absolute -top-1.5 -left-1.5 size-12 max-w-none"
          aria-hidden="true"
        />
      </div>
      <div className="flex min-w-0 grow items-start gap-1">
        <div className="flex min-w-0 grow flex-col justify-center gap-1.5">
          <div className="text-[15px] leading-[1.2] font-semibold text-text-primary">{title}</div>
          <div className="body-md-regular text-text-secondary">
            {renderDescription(description)}
          </div>
        </div>
        <button
          type="button"
          className="-mt-1.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md p-0.5 text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-components-input-border-active"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <span className="i-ri-close-line size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
