'use client'

import type { StudioPageType } from '.'
import { cn } from '@langgenius/dify-ui/cn'
import Link from '@/next/link'

type Props = {
  pageType: StudioPageType
  appsLabel: string
  snippetsLabel: string
  showSnippets?: boolean
}

const StudioRouteSwitch = ({
  pageType,
  appsLabel,
  snippetsLabel,
  showSnippets = true,
}: Props) => {
  return (
    <div className="flex items-center rounded-lg border-[0.5px] border-divider-subtle bg-[rgba(200,206,218,0.2)] p-px">
      <Link
        href="/apps"
        className={cn(
          'flex h-8 items-center rounded-lg px-3 text-[14px] leading-5 text-text-secondary',
          pageType === 'apps' && 'bg-components-card-bg font-semibold text-text-primary shadow-xs',
          pageType !== 'apps' && 'font-medium',
        )}
      >
        {appsLabel}
      </Link>
      {showSnippets && (
        <Link
          href="/snippets"
          className={cn(
            'flex h-8 items-center rounded-lg px-3 text-[14px] leading-5 text-text-secondary',
            pageType === 'snippets' && 'bg-components-card-bg font-semibold text-text-primary shadow-xs',
            pageType !== 'snippets' && 'font-medium',
          )}
        >
          {snippetsLabel}
        </Link>
      )}
    </div>
  )
}

export default StudioRouteSwitch
