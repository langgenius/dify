import type { Theme } from './deck/hooks'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Meter, MeterIndicator, MeterTrack } from '@langgenius/dify-ui/meter'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { useEffect, useState } from 'react'
import { DataDialog } from './deck/data-dialog'
import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  toggleFullscreen,
  useIdle,
  useSlideIndex,
  useStageScale,
  useTheme,
} from './deck/hooks'
import { DifyLogo } from './deck/parts'
import { slides } from './deck/slides'

const LAST_INDEX = slides.length - 1
const IDLE_TIMEOUT_MS = 3000

type ChromeProps = {
  index: number
  section: string
  theme: Theme
  hidden: boolean
  onPrevious: () => void
  onNext: () => void
  onOpenData: () => void
  onThemeChange: (theme: Theme) => void
}

function Chrome({
  index,
  section,
  theme,
  hidden,
  onPrevious,
  onNext,
  onOpenData,
  onThemeChange,
}: ChromeProps) {
  return (
    <footer
      className={cn(
        'absolute inset-x-0 bottom-0 flex items-center justify-between px-[120px] pb-10 transition-opacity duration-500',
        hidden && 'opacity-0',
      )}
    >
      <div className="flex items-center gap-4 text-[20px] text-text-tertiary">
        <DifyLogo className="h-6 w-auto text-text-primary" />
        <span>Six months in the open</span>
        <span aria-hidden>·</span>
        <span>{section}</span>
      </div>

      <div className="flex items-center gap-5">
        <IconButton
          variant="ghost"
          size="xl"
          aria-label="Previous slide"
          disabled={index === 0}
          onClick={onPrevious}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-5" />
        </IconButton>
        <div className="w-[320px]">
          <Meter value={index + 1} max={slides.length} aria-label="Position in the deck">
            <MeterTrack className="h-1.5">
              <MeterIndicator />
            </MeterTrack>
          </Meter>
        </div>
        <span className="min-w-[72px] text-center text-[20px] text-text-tertiary tabular-nums">
          {index + 1} / {slides.length}
        </span>
        <IconButton
          variant="ghost"
          size="xl"
          aria-label="Next slide"
          disabled={index === LAST_INDEX}
          onClick={onNext}
        >
          <span aria-hidden className="i-ri-arrow-right-line size-5" />
        </IconButton>
      </div>

      <div className="flex items-center gap-5">
        <Button variant="secondary" size="medium" onClick={onOpenData}>
          <span aria-hidden className="i-ri-table-line size-4" />
          Data
          <Kbd>D</Kbd>
        </Button>
        <SegmentedControl<Theme>
          aria-label="Theme"
          value={theme}
          onValueChange={(next) => onThemeChange(next)}
        >
          <SegmentedControlItem<Theme> value="light" aria-label="Light theme">
            <span aria-hidden className="i-ri-sun-line size-4" />
          </SegmentedControlItem>
          <SegmentedControlItem<Theme> value="dark" aria-label="Dark theme">
            <span aria-hidden className="i-ri-moon-line size-4" />
          </SegmentedControlItem>
        </SegmentedControl>
        <IconButton
          variant="ghost"
          size="xl"
          aria-label="Toggle fullscreen"
          onClick={toggleFullscreen}
        >
          <span aria-hidden className="i-ri-fullscreen-line size-5" />
        </IconButton>
        <KbdGroup>
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
        </KbdGroup>
      </div>
    </footer>
  )
}

export function App() {
  const scale = useStageScale()
  const [theme, setTheme] = useTheme()
  const [index, setIndex] = useSlideIndex(slides.length)
  const [dataOpen, setDataOpen] = useState(false)
  const idle = useIdle(IDLE_TIMEOUT_MS)
  const slide = slides[index] ?? slides[0]

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (dataOpen) return

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case 'Enter':
        case ' ':
          event.preventDefault()
          setIndex((current) => Math.min(current + 1, LAST_INDEX))
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          event.preventDefault()
          setIndex((current) => Math.max(current - 1, 0))
          break
        case 'Home':
          setIndex(0)
          break
        case 'End':
          setIndex(LAST_INDEX)
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 't':
        case 'T':
          setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
          break
        case 'd':
        case 'D':
          setDataOpen(true)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dataOpen, setIndex, setTheme])

  if (!slide) return null

  const Active = slide.component

  return (
    <TooltipProvider delay={150}>
      <main className="fixed inset-0 overflow-hidden bg-background-body text-text-primary">
        <div
          className="absolute top-1/2 left-1/2 overflow-hidden"
          style={{
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        >
          <div key={slide.id} className="absolute inset-0">
            <Active />
          </div>
          <Chrome
            index={index}
            section={slide.section}
            theme={theme}
            hidden={idle}
            onPrevious={() => setIndex((current) => Math.max(current - 1, 0))}
            onNext={() => setIndex((current) => Math.min(current + 1, LAST_INDEX))}
            onOpenData={() => setDataOpen(true)}
            onThemeChange={setTheme}
          />
        </div>
      </main>
      <DataDialog open={dataOpen} onOpenChange={setDataOpen} slide={slide} />
    </TooltipProvider>
  )
}
