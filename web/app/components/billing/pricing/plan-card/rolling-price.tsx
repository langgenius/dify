import { cn } from '@langgenius/dify-ui/cn'

type RollingPriceProps = {
  monthly: number
  annual: number
  isYearly: boolean
}

export function RollingPrice({ monthly, annual, isYearly }: RollingPriceProps) {
  const annualDigits = String(annual)
  const monthlyDigits = String(monthly).padStart(annualDigits.length, ' ')

  return (
    <>
      <span className="sr-only">{`$${isYearly ? annual : monthly}`}</span>
      <span aria-hidden="true" dir="ltr" className="inline-flex align-bottom tabular-nums">
        $
        {Array.from(annualDigits, (digit, index) => {
          const start = Number(monthlyDigits[index])
          // Roll through 9 to 0 when a larger total has a smaller digit in this place.
          const steps = (Number(digit) - start + 10) % 10
          const reel = Array.from({ length: steps + 1 }, (_, step) => (start + step) % 10)
          const collapsed = !isYearly && monthlyDigits[index] === ' '
          const place = annualDigits.length - index
          return (
            <span
              key={place}
              className={cn(
                'flex h-lh justify-end overflow-hidden mask-[linear-gradient(to_bottom,transparent,black_16%,black_84%,transparent)]',
                collapsed ? 'w-0' : 'w-[1ch]',
              )}
            >
              <span
                className="block w-[1ch] shrink-0 text-center whitespace-pre motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ transform: `translateY(-${isYearly ? steps : 0}lh)` }}
              >
                {reel.join('\n')}
              </span>
            </span>
          )
        })}
      </span>
    </>
  )
}
