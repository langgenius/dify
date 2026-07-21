import type { RefObject } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type IndexBarProps = {
  letters: string[]
  itemRefs: RefObject<{ [key: string]: HTMLElement | null }>
  className?: string
}

export function IndexBar({ letters, itemRefs, className }: IndexBarProps) {
  const handleIndexClick = (letter: string) => {
    const element = itemRefs.current?.[letter]
    if (element) element.scrollIntoView({ behavior: 'smooth' })
  }
  return (
    <div
      className={cn(
        'sticky top-5 flex h-full w-6 flex-col items-center justify-center text-xs font-medium text-text-quaternary',
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute top-0 left-0 h-full w-px bg-[linear-gradient(270deg,rgba(255,255,255,0)_0%,rgba(16,24,40,0.08)_30%,rgba(16,24,40,0.08)_50%,rgba(16,24,40,0.08)_70.5%,rgba(255,255,255,0)_100%)]"
      />
      {letters.map((letter) => (
        <button
          type="button"
          className="flex h-4 w-5 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          key={letter}
          onClick={() => handleIndexClick(letter)}
        >
          {letter}
        </button>
      ))}
    </div>
  )
}
