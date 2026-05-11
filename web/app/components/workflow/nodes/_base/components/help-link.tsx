import type { BlockEnum } from '@/app/components/workflow/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeHelpLink } from '../hooks/use-node-help-link'

type HelpLinkProps = {
  nodeType: BlockEnum
}
const HelpLink = ({
  nodeType,
}: HelpLinkProps) => {
  const { t } = useTranslation()
  const link = useNodeHelpLink(nodeType)

  if (!link)
    return null

  const label = t('userProfile.helpCenter', { ns: 'common' })

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <a
            aria-label={label}
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mr-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-state-base-hover"
          >
            <span aria-hidden className="i-ri-book-open-line h-4 w-4 text-gray-500" />
          </a>
        )}
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export default memo(HelpLink)
