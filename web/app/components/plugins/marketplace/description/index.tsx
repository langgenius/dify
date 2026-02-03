'use client'

import { useTranslation } from '#i18n'
import { cn } from '@/utils/classnames'
import PluginTypeSwitch from '../plugin-type-switch'
import HeroIllustration from './hero-illustration'

type DescriptionProps = {
  className?: string
}

export const Description = ({ className }: DescriptionProps) => {
  const { t } = useTranslation('plugin')

  return (
    <div className={cn('relative mx-4 mt-4 h-[200px] rounded-2xl bg-gradient-to-r from-util-colors-blue-brand-blue-brand-600 to-util-colors-blue-brand-blue-brand-500 px-8 py-6', className)}>
      {/* Background illustration */}
      <HeroIllustration />

      {/* Content */}
      <div className="relative z-10">
        <h1 className="title-4xl-semi-bold mb-2 shrink-0 text-text-primary-on-surface">
          {t('marketplace.heroTitle')}
        </h1>
        <h2 className="body-md-regular shrink-0 text-text-secondary-on-surface">
          {t('marketplace.heroSubtitle')}
        </h2>

        {/* Plugin type switch tabs */}
        <div className="mt-6">
          <PluginTypeSwitch variant="hero" />
        </div>
      </div>
    </div>
  )
}
