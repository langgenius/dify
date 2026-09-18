import type { BlockEnum } from '@/app/components/workflow/types'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeHelpLink } from '../hooks/use-node-help-link'

type HelpLinkProps = {
  nodeType: BlockEnum
}
const HelpLink = ({ nodeType }: HelpLinkProps) => {
  const { t } = useTranslation()
  const link = useNodeHelpLink(nodeType)

  if (!link) return null

  const label = t(($) => $['userProfile.helpCenter'], { ns: 'common' })

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            aria-label={label}
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'small' }),
              'mr-1 w-6 p-0 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            )}
          >
            <span aria-hidden className="i-ri-book-open-line size-4" />
          </a>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export default memo(HelpLink)
