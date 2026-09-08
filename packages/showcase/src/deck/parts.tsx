import type { CSSProperties, ReactNode } from 'react'
import type { Release } from './figures'
import { cn } from '@langgenius/dify-ui/cn'
import { Meter, MeterIndicator, MeterTrack } from '@langgenius/dify-ui/meter'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { dayIndex, formatDate, formatNumber, months, PERIOD, releases } from './figures'
import { useCountUp } from './hooks'

/** Entrance order for `.deck-rise` elements; each step lands 110ms after the previous one. */
export function stagger(step: number): CSSProperties {
  return { '--i': step } as CSSProperties
}

type LogoProps = {
  className?: string
}

/** The Dify wordmark from `web/public/logo/logo.svg`, recoloured with tokens so it works on both themes. */
export function DifyLogo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 48 22" className={className} role="img" aria-label="Dify">
      <path
        fill="var(--color-text-accent)"
        d="M21.2002 3.73454C22.5633 3.73454 23.0666 2.89917 23.0666 1.86812C23.0666 0.837081 22.5623 0.00170898 21.2002 0.00170898C19.838 0.00170898 19.3337 0.837081 19.3337 1.86812C19.3337 2.89917 19.838 3.73454 21.2002 3.73454Z"
      />
      <path
        fill="var(--color-text-accent)"
        d="M27.7336 4.13435V5.33473H24.6668V8.00171H27.7336V14.6687H22.6668V5.33567H15.9998V8.00265H19.7336V14.6696H15.3337V17.3366H35.3337V14.6696H30.6668V8.00265H35.3337V5.33567H30.6668V2.66869H35.3337V0.00170898H31.8671C29.5877 0.00170898 27.7336 1.8559 27.7336 4.13529V4.13435Z"
      />
      <path
        fill="currentColor"
        d="M5.66698 0.000940576H0V17.334H5.66698C12.667 17.334 14.667 13.334 14.667 8.66698C14.667 4 12.667 0 5.66698 0V0.000940576ZM5.73377 14.6679H3.20038V2.66792H5.73377C9.75823 2.66792 11.4666 4.64346 11.4666 8.66792C11.4666 12.6924 9.75823 14.6679 5.73377 14.6679Z"
      />
      <path
        fill="currentColor"
        d="M44.8335 5.3349L42.1665 14.0019L39.4995 5.3349H36.333L40.2013 16.5466C40.604 17.714 39.9229 18.6679 38.6886 18.6679H37.333V21.3349H39.3255C41.063 21.3349 42.6265 20.2361 43.2145 18.6011L48 5.3349H44.8335Z"
      />
    </svg>
  )
}

type FrameProps = {
  children: ReactNode
  className?: string
  /** Soft brand-blue wash behind the content; reserved for the opening, section and closing slides. */
  glow?: boolean
}

export function SlideFrame({ children, className, glow = false }: FrameProps) {
  return (
    <section className="absolute inset-0 px-[120px] pt-[104px] pb-[132px]">
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(54% 48% at 22% 30%, var(--viz-glow), transparent 72%)',
          }}
        />
      )}
      <div className={cn('relative flex h-full min-h-0 flex-col', className)}>{children}</div>
    </section>
  )
}

type TextProps = {
  children: ReactNode
  className?: string
  step?: number
}

export function Eyebrow({ children, className, step = 0 }: TextProps) {
  return (
    <p
      className={cn(
        'deck-rise text-[22px] leading-none font-semibold tracking-[0.16em] text-text-tertiary uppercase',
        className,
      )}
      style={stagger(step)}
    >
      {children}
    </p>
  )
}

export function Headline({ children, className, step = 0 }: TextProps) {
  return (
    <h2
      className={cn(
        'deck-rise mt-7 text-[72px] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-text-primary',
        className,
      )}
      style={stagger(step)}
    >
      {children}
    </h2>
  )
}

export function Lede({ children, className, step = 0 }: TextProps) {
  return (
    <p
      className={cn('deck-rise text-[34px] leading-[1.35] text-text-secondary', className)}
      style={stagger(step)}
    >
      {children}
    </p>
  )
}

type StatTileProps = {
  label: string
  value: number
  decimals?: number
  suffix?: string
  note?: string
  step?: number
  size?: 'sm' | 'md' | 'lg'
}

const statValueSize = {
  sm: 'text-[76px]',
  md: 'text-[96px]',
  lg: 'text-[128px]',
} as const

/** Label · value · note. The value counts up on entrance and uses proportional figures on purpose. */
export function StatTile({
  label,
  value,
  decimals = 0,
  suffix = '',
  note,
  step = 0,
  size = 'lg',
}: StatTileProps) {
  const shown = useCountUp(value, {
    decimals,
    delay: 200 + step * 110,
    duration: size === 'sm' ? 1000 : 1400,
  })

  return (
    <div className="deck-rise flex min-w-0 flex-col gap-3" style={stagger(step)}>
      <p className="text-[24px] leading-tight font-medium text-text-tertiary">{label}</p>
      <p
        className={cn(
          'leading-none font-semibold tracking-[-0.04em] text-text-primary',
          statValueSize[size],
        )}
      >
        {formatNumber(shown, decimals)}
        {suffix}
      </p>
      {note && <p className="text-[22px] leading-snug text-text-tertiary">{note}</p>}
    </div>
  )
}

type HeroFigureProps = {
  value: number
  decimals?: number
  suffix?: string
  label: string
  step?: number
}

/** The one number a slide leads with. */
export function HeroFigure({ value, decimals = 0, suffix = '', label, step = 0 }: HeroFigureProps) {
  const shown = useCountUp(value, { decimals, delay: 300 + step * 110, duration: 1600 })

  return (
    <div className="deck-rise" style={stagger(step)}>
      <p className="text-[208px] leading-none font-semibold tracking-[-0.05em] text-text-primary">
        {formatNumber(shown, decimals)}
        {suffix}
      </p>
      <p className="mt-5 text-[28px] leading-snug text-text-secondary">{label}</p>
    </div>
  )
}

export type LegendItem = {
  label: string
  value: string
  tone: 'accent' | 'rest' | 'track'
}

const legendSwatch = {
  accent: 'bg-(--viz-accent)',
  rest: 'bg-(--viz-rest)',
  track: 'bg-(--viz-track)',
} as const

type LegendProps = {
  items: LegendItem[]
  step?: number
}

export function Legend({ items, step = 0 }: LegendProps) {
  return (
    <ul className="deck-rise m-0 flex list-none flex-col gap-4 p-0" style={stagger(step)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-4 text-[26px] leading-tight">
          <span
            aria-hidden
            className={cn('size-[18px] shrink-0 rounded-[5px]', legendSwatch[item.tone])}
          />
          <span className="text-text-secondary">{item.label}</span>
          <span className="font-semibold text-text-primary tabular-nums">{item.value}</span>
        </li>
      ))}
    </ul>
  )
}

type WaffleProps = {
  total: number
  filled: number
  columns: number
  cell: number
  gap: number
  label: string
  className?: string
}

/** Unit chart: one square per item, filled column by column from the left so the share reads as width. */
export function Waffle({ total, filled, columns, cell, gap, label, className }: WaffleProps) {
  const rows = Math.ceil(total / columns)
  const cells = Array.from({ length: total }, (_, index) => {
    const order = (index % columns) * rows + Math.floor(index / columns)
    return { id: index, lit: order < filled, order }
  })

  return (
    <div
      role="img"
      aria-label={label}
      className={cn('grid', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, ${cell}px)`, gap }}
    >
      {cells.map((item) => (
        <span
          key={item.id}
          aria-hidden
          className={cn(
            'deck-pop rounded-[6px]',
            item.lit ? 'bg-(--viz-accent)' : 'bg-(--viz-rest)',
          )}
          style={{
            width: cell,
            height: cell,
            animationDelay: item.lit ? `${320 + item.order * 7}ms` : '80ms',
          }}
        />
      ))}
    </div>
  )
}

type DotFieldProps = {
  count: number
  columns: number
  cell: number
  gap: number
  label: string
  className?: string
}

/** Unit chart with every item lit; the entrance ripples diagonally across the field. */
export function DotField({ count, columns, cell, gap, label, className }: DotFieldProps) {
  const dots = Array.from({ length: count }, (_, index) => ({
    id: index,
    row: Math.floor(index / columns),
    column: index % columns,
  }))

  return (
    <div
      role="img"
      aria-label={label}
      className={cn('grid', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, ${cell}px)`, gap }}
    >
      {dots.map((dot) => (
        <span
          key={dot.id}
          aria-hidden
          className="deck-pop rounded-full bg-(--viz-accent)"
          style={{
            width: cell,
            height: cell,
            animationDelay: `${200 + (dot.row + dot.column) * 12}ms`,
          }}
        />
      ))}
    </div>
  )
}

const TIMELINE = {
  width: 1680,
  height: 300,
  pad: 40,
  axisY: 196,
  /** Minimum horizontal distance between two version labels on the same lane. */
  labelGap: 108,
  /** Label lanes, as distance above the axis; a release takes the lowest free lane. */
  laneOffsets: [44, 88, 132],
} as const

type ReleasePoint = Release & {
  x: number
  lane: number
}

function layoutReleases(): ReleasePoint[] {
  const inner = TIMELINE.width - TIMELINE.pad * 2
  const laneEnds: number[] = []

  return releases.map((release) => {
    const x = TIMELINE.pad + (dayIndex(release.date) / PERIOD.days) * inner
    let lane = laneEnds.findIndex((end) => x - end >= TIMELINE.labelGap)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(x)
    } else {
      laneEnds[lane] = x
    }
    return { ...release, x, lane }
  })
}

type ReleaseTimelineProps = {
  step?: number
}

/** Stable releases on a real calendar axis. Labels that would collide move up a lane on a leader line. */
export function ReleaseTimeline({ step = 0 }: ReleaseTimelineProps) {
  const inner = TIMELINE.width - TIMELINE.pad * 2
  const xForDay = (day: number) => TIMELINE.pad + (day / PERIOD.days) * inner
  const points = layoutReleases()

  return (
    <div
      className="deck-rise relative"
      style={{ width: TIMELINE.width, height: TIMELINE.height, ...stagger(step) }}
    >
      <div
        aria-hidden
        className="absolute h-px bg-divider-deep"
        style={{ left: TIMELINE.pad, width: inner, top: TIMELINE.axisY }}
      />
      {months.map((month) => (
        <div key={month.label} aria-hidden>
          <span
            className="absolute w-px bg-divider-deep"
            style={{ left: xForDay(month.startDay), top: TIMELINE.axisY - 6, height: 12 }}
          />
          <span
            className="absolute -translate-x-1/2 text-[20px] leading-none font-medium tracking-[0.08em] text-text-tertiary uppercase"
            style={{
              left: xForDay(month.startDay + month.length / 2),
              top: TIMELINE.axisY + 28,
            }}
          >
            {month.label}
          </span>
        </div>
      ))}
      <span
        aria-hidden
        className="absolute w-px bg-divider-deep"
        style={{ left: xForDay(PERIOD.days), top: TIMELINE.axisY - 6, height: 12 }}
      />
      <ul className="m-0 list-none p-0">
        {points.map((point) => {
          const offset = TIMELINE.laneOffsets[point.lane] ?? TIMELINE.laneOffsets[2]
          return (
            <li key={point.tag} className="absolute top-0" style={{ left: point.x }}>
              <span
                aria-hidden
                className="absolute left-0 w-px bg-divider-deep"
                style={{ top: TIMELINE.axisY - offset + 2, height: offset - 16 }}
              />
              <span
                aria-hidden
                className="absolute -translate-x-1/2 text-[22px] leading-none font-medium whitespace-nowrap text-text-secondary tabular-nums"
                style={{ top: TIMELINE.axisY - offset - 24 }}
              >
                v{point.tag}
              </span>
              <Tooltip>
                <TooltipTrigger
                  aria-label={`v${point.tag}, ${formatDate(point.date)}`}
                  className="absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full bg-(--viz-accent) ring-[3px] ring-background-body transition-transform hover:scale-125 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:scale-125"
                  style={{ top: TIMELINE.axisY }}
                />
                <TooltipContent>
                  v{point.tag} · {formatDate(point.date)}
                </TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

type SegmentMeterProps = {
  value: number
  max: number
  label: string
  step?: number
}

/** A Dify Meter with one block per unit; the gaps are the surface showing through. */
export function SegmentMeter({ value, max, label, step = 0 }: SegmentMeterProps) {
  const segments = Array.from({ length: max }, (_, index) => index + 1)

  return (
    <div className="deck-rise" style={stagger(step)}>
      <Meter value={value} max={max} aria-label={label}>
        <MeterTrack className="h-[96px] rounded-[22px] bg-(--viz-track)">
          <MeterIndicator className="deck-grow-x rounded-none bg-(--viz-accent)" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 grid"
            style={{ gridTemplateColumns: `repeat(${max}, minmax(0, 1fr))` }}
          >
            {segments.map((segment) => (
              <span
                key={segment}
                className={cn('h-full', segment > 1 && 'border-l-4 border-background-body')}
              />
            ))}
          </div>
        </MeterTrack>
      </Meter>
    </div>
  )
}

type RingProps = {
  /** Percentage, 0–100. */
  share: number
  label: string
  size?: number
  stroke?: number
  step?: number
  children: ReactNode
}

/** Ring meter: one value against its whole. The track is a lighter step of the same hue. */
export function Ring({ share, label, size = 460, stroke = 34, step = 0, children }: RingProps) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div
      className="deck-rise relative shrink-0"
      style={{ width: size, height: size, ...stagger(step) }}
    >
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${size} ${size}`}
        className="size-full -rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--viz-track)"
          strokeWidth={stroke}
        />
        <circle
          className="deck-ring"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--viz-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share / 100)}
          style={{ '--ring-circumference': circumference } as CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  )
}
