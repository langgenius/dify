'use client'

import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type ToolsNavProps = {
  className?: string
}

const ToolsNav = ({
  className,
}: ToolsNavProps) => {
  const { t } = useTranslation()
  const selectedSegment = useSelectedLayoutSegment()
  const activated = selectedSegment === 'tools'

  return (
    <Link
      href="/tools"
      className={cn('group text-sm font-medium', activated && 'hover:bg-components-main-nav-nav-button-bg-active-hover bg-components-main-nav-nav-button-bg-active font-semibold shadow-md', activated ? 'text-components-main-nav-nav-button-text-active' : 'text-components-main-nav-nav-button-text hover:bg-components-main-nav-nav-button-bg-hover', className)}
    >
      {
        activated
          ? <span className="i-ri-hammer-fill h-4 w-4" />
          : <span className="i-ri-hammer-line h-4 w-4" />
      }
      <div className="ml-2 max-[1024px]:hidden">
        {t('menus.tools', { ns: 'common' })}
      </div>
    </Link>
  )
}

export default ToolsNav
