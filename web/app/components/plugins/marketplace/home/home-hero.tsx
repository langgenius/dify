import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import Github from '@/app/components/base/icons/src/public/common/Github'
import duckDuckGoIcon from './assets/duckduckgo.png'

type HomeHeroProps = {
  isMarketplacePlatform: boolean
  subtitle?: ReactNode
  title?: ReactNode
}

const heroDecorationIconFrameClassName =
  'absolute flex size-10 items-center justify-center overflow-hidden rounded-[10px] bg-components-panel-bg shadow-lg'

const DropboxIcon = () => (
  <svg className="size-10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      fill="#0061FF"
      d="m7 3-5 3.2L7 9.4l5-3.2L7 3Zm10 0-5 3.2 5 3.2 5-3.2L17 3ZM7 10.6l-5 3.2L7 17l5-3.2-5-3.2Zm10 0-5 3.2 5 3.2 5-3.2-5-3.2ZM7.2 18.1l4.8 3 4.8-3-4.8-3-4.8 3Z"
    />
  </svg>
)

const DuckDuckGoIcon = () => (
  <img src={duckDuckGoIcon.src} alt="" className="size-10 object-cover" />
)

const GmailIcon = () => (
  <svg className="size-10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="24" height="24" rx="6" fill="white" />
    <path
      d="M4.5 7.2v9.3c0 .66.54 1.2 1.2 1.2h1.35V10.2L12 13.95l4.95-3.75v7.5h1.35c.66 0 1.2-.54 1.2-1.2V7.2c0-1.5-1.7-2.35-2.9-1.45L12 9.15 7.4 5.75C6.2 4.85 4.5 5.7 4.5 7.2Z"
      fill="#EA4335"
    />
    <path d="M5.7 17.7h1.35V10.2L4.5 8.4v8.1c0 .66.54 1.2 1.2 1.2Z" fill="#34A853" />
    <path d="M18.3 17.7h-1.35V10.2l2.55-1.8v8.1c0 .66-.54 1.2-1.2 1.2Z" fill="#4285F4" />
    <path
      d="M19.5 7.2v-.75c0-1.5-1.7-2.35-2.9-1.45L12 9.15 7.4 5.75C6.2 4.85 4.5 5.7 4.5 6.45V8.4L12 13.95 19.5 8.4V7.2Z"
      fill="#C5221F"
    />
    <path
      d="M4.5 8.4 12 13.95 19.5 8.4"
      stroke="#EA4335"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
  </svg>
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
          <span className={heroDecorationIconFrameClassName} style={{ left: 86, top: 50 }}>
            <DropboxIcon />
          </span>
          <span className={heroDecorationIconFrameClassName} style={{ left: 24, top: 114 }}>
            <DuckDuckGoIcon />
          </span>
          <span className={heroDecorationIconFrameClassName} style={{ left: 602, top: 16 }}>
            <Github className="size-10" />
          </span>
          <span className={heroDecorationIconFrameClassName} style={{ left: 664, top: 98 }}>
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
