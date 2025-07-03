'use client'
import { useTranslation } from 'react-i18next'
import { ToolTypeEnum } from '../../workflow/block-selector/types'
import { RiArrowRightUpLine } from '@remixicon/react'
import Link from 'next/link'
import cn from '@/utils/classnames'
type Props = {
  type?: ToolTypeEnum
  isAgent?: boolean
}

const getLink = (type?: ToolTypeEnum) => {
  switch (type) {
    case ToolTypeEnum.Custom:
      return '/tools?category=api'
    case ToolTypeEnum.MCP:
      return '/tools?category=mcp'
    default:
      return '/tools?category=api'
  }
}
const Empty = ({
  type,
  isAgent,
}: Props) => {
  const { t } = useTranslation()

  const hasLink = type && [ToolTypeEnum.Custom, ToolTypeEnum.MCP].includes(type)
  const Comp = (hasLink ? Link : 'div') as any
  const linkProps = hasLink ? { href: getLink(type), target: '_blank' } : {}
  const renderType = isAgent ? 'agent' : type

  return (
    <div className='flex flex-col items-center'>
      <div className="h-[149px] w-[163px] shrink-0 bg-[url('~@/app/components/tools/add-tool-modal/empty.png')] bg-cover bg-no-repeat"></div>
      <div className='mb-1 text-[13px] font-medium leading-[18px] text-text-primary'>
        {t(`tools.addToolModal.${renderType}.title`)}
      </div>
      {!isAgent && (
        <Comp className={cn('flex items-center text-[13px] leading-[18px] text-text-tertiary', hasLink && 'cursor-pointer hover:text-text-accent')} {...linkProps}>
          {t(`tools.addToolModal.${renderType}.tip`)} {hasLink && <RiArrowRightUpLine className='ml-0.5 h-3 w-3' />}
        </Comp>
      )}
    </div>
  )
}

export default Empty
