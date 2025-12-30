import type { BlockEnum } from '@/app/components/workflow/types'
import { RiBookOpenLine } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import TooltipPlus from '@/app/components/base/tooltip'
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

  return (
    <TooltipPlus
      popupContent={t('userProfile.helpCenter', { ns: 'common' })}
    >
      <a
        href={link}
        target="_blank"
        className="mr-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-state-base-hover"
      >
        <RiBookOpenLine className="h-4 w-4 text-gray-500" />
      </a>
    </TooltipPlus>

  )
}

export default memo(HelpLink)
