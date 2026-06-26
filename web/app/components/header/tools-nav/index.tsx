'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  RiHammerFill,
  RiHammerLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import Link from '@/next/link'
import { useSelectedLayoutSegment } from '@/next/navigation'

export function ToolsNav({
  className,
}: {
  className?: string
}) {
  const { t } = useTranslation()
  const selectedSegment = useSelectedLayoutSegment()
  const activated = selectedSegment === 'integrations' || selectedSegment === 'tools'

  return (
    <Link
      href={buildIntegrationPath('builtin')}
      className={cn('group text-sm font-medium', activated && 'hover:bg-components-main-nav-nav-button-bg-active-hover bg-components-main-nav-nav-button-bg-active font-semibold shadow-md', activated ? 'text-components-main-nav-nav-button-text-active' : 'text-components-main-nav-nav-button-text hover:bg-components-main-nav-nav-button-bg-hover', className)}
    >
      {
        activated
          ? <RiHammerFill className="size-4" />
          : <RiHammerLine className="size-4" />
      }
      <div className="ml-2 max-[1120px]:hidden">
        {t('menus.tools', { ns: 'common' })}
      </div>
    </Link>
  )
}
