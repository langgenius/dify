import { ChevronRight } from '../../icons/src/vender/line/arrows'

export default function ContentSwitch({
  count,
  currentIndex,
  prevDisabled,
  nextDisabled,
  switchSibling,
}: {
  count?: number
  currentIndex?: number
  prevDisabled: boolean
  nextDisabled: boolean
  switchSibling: (direction: 'prev' | 'next') => void
}) {
  return (
    count && count > 1 && currentIndex !== undefined && (
      <div className="flex items-center justify-center pt-3.5 text-sm">
        <button type="button"
          className={`${prevDisabled ? 'opacity-30' : 'opacity-100'}`}
          disabled={prevDisabled}
          onClick={() => !prevDisabled && switchSibling('prev')}
        >
          <ChevronRight className="h-[14px] w-[14px] rotate-180 text-text-primary" />
        </button>
        <span className="px-2 text-xs text-text-primary">
          {currentIndex + 1} / {count}
        </span>
        <button type="button"
          className={`${nextDisabled ? 'opacity-30' : 'opacity-100'}`}
          disabled={nextDisabled}
          onClick={() => !nextDisabled && switchSibling('next')}
        >
          <ChevronRight className="h-[14px] w-[14px] text-text-primary" />
        </button>
      </div>
    )
  )
}
