import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import dropboxDarkIcon from './assets/dropbox-dark.svg'
import dropboxLightIcon from './assets/dropbox-light.svg'
import duckDuckGoDarkIcon from './assets/duckduckgo-dark.svg'
import duckDuckGoLightIcon from './assets/duckduckgo-light.svg'
import githubDarkIcon from './assets/github-dark.svg'
import githubLightIcon from './assets/github-light.svg'
import googleDarkIcon from './assets/google-dark.svg'
import googleLightIcon from './assets/google-light.svg'
import styles from './home-hero.module.css'

type HomeHeroProps = {
  isMarketplacePlatform: boolean
  subtitle?: ReactNode
  title?: ReactNode
}

const heroDecorationIconFrameClassName =
  'absolute flex size-10 items-center justify-center overflow-hidden rounded-[10px] bg-components-panel-bg shadow-lg'

// Brand marks stay file exports so multi-color logos render. Tailwind iconify
// classes mask to currentColor and would flatten or hide them.
const ThemeIcon = ({
  darkSrc,
  lightSrc,
}: {
  darkSrc: string
  lightSrc: string
}) => (
  <>
    <img
      alt=""
      aria-hidden
      className={cn('size-10 object-cover', styles.iconLight)}
      src={lightSrc}
    />
    <img
      alt=""
      aria-hidden
      className={cn('size-10 object-cover', styles.iconDark)}
      src={darkSrc}
    />
  </>
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
        <div aria-hidden className={cn('pointer-events-none absolute inset-0', styles.decorations)}>
          <span className={heroDecorationIconFrameClassName} style={{ left: 99, top: 26 }}>
            <ThemeIcon darkSrc={dropboxDarkIcon.src} lightSrc={dropboxLightIcon.src} />
          </span>
          <span className={heroDecorationIconFrameClassName} style={{ left: 12, top: 89 }}>
            <ThemeIcon darkSrc={duckDuckGoDarkIcon.src} lightSrc={duckDuckGoLightIcon.src} />
          </span>
          <span className={heroDecorationIconFrameClassName} style={{ left: 589, top: 4 }}>
            <ThemeIcon darkSrc={githubDarkIcon.src} lightSrc={githubLightIcon.src} />
          </span>
          <span className={heroDecorationIconFrameClassName} style={{ left: 653, top: 68 }}>
            <ThemeIcon darkSrc={googleDarkIcon.src} lightSrc={googleLightIcon.src} />
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
