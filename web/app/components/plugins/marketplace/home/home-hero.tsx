'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'

type HomeHeroProps = {
  isMarketplacePlatform: boolean
}

const HomeHero = ({ isMarketplacePlatform }: HomeHeroProps) => {
  const { t } = useTranslation('plugin')

  return (
    <section
      className={cn(
        'relative flex shrink-0 justify-center bg-background-default px-4',
        !isMarketplacePlatform && 'pt-6',
      )}
    >
      <div className="relative flex h-[162px] w-full max-w-[726px] flex-col items-center pt-[41px]">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1
            className="text-[28px] leading-[1.2] font-medium tracking-[-0.56px] text-text-primary"
            style={{ fontFamily: "var(--font-family-brand, 'Söhne', var(--font-sans))" }}
          >
            {t(($) => $['marketplace.home.heroTitle'])}
          </h1>
          <p className="text-[13px] leading-4 font-light tracking-[-0.065px] text-text-tertiary">
            {t(($) => $['marketplace.home.heroSubtitle'])}
          </p>
        </div>
      </div>
    </section>
  )
}

export default HomeHero
