'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import blueBrick from './assets/blue-brick.png'
import greenFlag from './assets/green-flag.png'
import magnifyingGlass from './assets/magnifying-glass.png'
import redBrick from './assets/red-brick.png'
import star from './assets/star.png'
import telescope from './assets/telescope.png'

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
        <div className="relative z-10 flex flex-col items-center gap-2 text-center">
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.56px] text-text-primary">
            {t(($) => $['marketplace.home.heroTitle'])}
          </h1>
          <p className="text-[13px] leading-4 font-light tracking-[-0.065px] text-text-tertiary">
            {t(($) => $['marketplace.home.heroSubtitle'])}
          </p>
        </div>

        <img
          src={blueBrick.src}
          width={93}
          height={91}
          alt=""
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-0 h-[91px] w-[93px] -translate-y-1/2 -rotate-[44deg] select-none"
        />
        <img
          src={magnifyingGlass.src}
          width={26}
          height={22}
          alt=""
          aria-hidden
          className="pointer-events-none absolute top-[28px] left-[169px] hidden h-[22px] w-[26px] select-none opacity-[0.88] sm:block"
        />
        <img
          src={star.src}
          width={16}
          height={16}
          alt=""
          aria-hidden
          className="pointer-events-none absolute top-3 left-[294px] hidden size-4 -scale-y-100 select-none opacity-[0.88] sm:block"
        />
        <img
          src={greenFlag.src}
          width={24}
          height={24}
          alt=""
          aria-hidden
          className="pointer-events-none absolute top-0 left-[409px] hidden size-6 rotate-45 select-none opacity-[0.88] sm:block"
        />
        <img
          src={redBrick.src}
          width={21}
          height={20}
          alt=""
          aria-hidden
          className="pointer-events-none absolute top-[23px] left-[541px] hidden h-5 w-[21px] -rotate-[60deg] select-none opacity-[0.88] sm:block"
        />
        <img
          src={telescope.src}
          width={93}
          height={93}
          alt=""
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-0 size-[93px] -translate-y-1/2 rotate-[15deg] select-none"
        />
      </div>
    </section>
  )
}

export default HomeHero
