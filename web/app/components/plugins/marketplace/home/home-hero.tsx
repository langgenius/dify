import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import Github from '@/app/components/base/icons/src/public/common/Github'
import duckDuckGoIcon from './assets/duckduckgo.png'
import gmailIcon from './assets/gmail.svg'

type HomeHeroProps = {
  isMarketplacePlatform: boolean
  subtitle?: ReactNode
  title?: ReactNode
}

const heroDecorationIconFrameClassName =
  'absolute flex size-10 items-center justify-center overflow-hidden rounded-[10px] bg-components-panel-bg shadow-lg'

// DuckDuckGo and Gmail stay file exports so their multi-color marks render.
// Tailwind iconify classes mask to currentColor and would flatten or hide them.
const DuckDuckGoIcon = () => (
  <img src={duckDuckGoIcon.src} alt="" className="size-10 object-cover" />
)

const GmailIcon = () => (
  <img src={gmailIcon.src} alt="" className="size-10 object-cover" />
)

const HomeHero = ({ isMarketplacePlatform, subtitle, title }: HomeHeroProps) => {
  const { t } = useTranslation('plugin')

  return (
    <section
      className={cn(
        'relative flex shrink-0 justify-center bg-background-default px-4',
        !isMarketplacePlatform && 'pt-6',
      )}
    >
      <div className="relative flex h-[162px] w-full max-w-[726px] flex-col items-center pt-[41px]">
        <div aria-hidden className="pointer-events-none absolute inset-0 max-[879px]:hidden">
          <span className={heroDecorationIconFrameClassName} style={{ left: 99, top: 26 }}>
            <span className="i-custom-public-common-dropbox size-10" />
          </span>
          <span className={heroDecorationIconFrameClassName} style={{ left: 12, top: 89 }}>
            <DuckDuckGoIcon />
          </span>
          <span className={heroDecorationIconFrameClassName} style={{ left: 589, top: 4 }}>
            <Github className="size-10" />
          </span>
          <span className={heroDecorationIconFrameClassName} style={{ left: 653, top: 68 }}>
            <GmailIcon />
          </span>
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1
            className="text-[28px] leading-[1.2] font-medium tracking-[-0.56px] text-text-primary"
            style={{ fontFamily: "var(--font-family-brand, 'Söhne', var(--font-sans))" }}
          >
            {title ?? t(($) => $['marketplace.home.heroTitle'])}
          </h1>
          <p className="text-[13px] leading-4 font-light tracking-[-0.065px] text-text-tertiary">
            {subtitle ?? t(($) => $['marketplace.home.heroSubtitle'])}
          </p>
        </div>
      </div>
    </section>
  )
}

export default HomeHero
