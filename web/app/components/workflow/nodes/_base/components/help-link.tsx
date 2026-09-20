import type { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { iconButtonVariants } from '@langgenius/dify-ui/icon-button'
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
            className={cn(iconButtonVariants({ size: 'md' }), 'mr-1')}
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
