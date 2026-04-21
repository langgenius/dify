'use client'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { RiArrowRightUpLine, RiBookOpenLine } from '@remixicon/react'
import Link from 'next/link'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button, { buttonVariants } from '@/app/components/base/button'
import { Playground, Plugin } from '@/app/components/base/icons/src/vender/plugin'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { CREATION_TYPE } from '@/app/components/plugins/marketplace/search-params'
import { MARKETPLACE_URL_PREFIX } from '@/config'
import { useDocLink } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import { useCreationType } from '../marketplace/atoms'

type DropdownItemProps = {
  href: string
  icon: React.ReactNode
  text: string
  onClick: () => void
}

const DropdownItem = ({ href, icon, text, onClick }: DropdownItemProps) => (
  <Link
    href={href}
    target="_blank"
    className="flex items-center gap-2 rounded-lg px-3 py-2 text-text-secondary hover:bg-state-base-hover hover:text-text-primary"
    onClick={onClick}
  >
    {icon}
    <span className="text-text-secondary system-sm-medium">{text}</span>
    <RiArrowRightUpLine className="ml-auto h-4 w-4 shrink-0 text-text-tertiary" />
  </Link>
)

type OptionLabelKey = 'requestAPlugin' | 'pluginPublishGuide' | 'pluginDevelopmentGuide' | 'templatePublishingGuide'

const getOptions = (docLink: (path: DocPathWithoutLang) => string): { href: string, icon: React.ReactNode, labelKey: OptionLabelKey }[] => {
  return [
    {
      href: 'https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml',
      icon: <Plugin className="h-4 w-4 shrink-0 text-text-tertiary" />,
      labelKey: 'requestAPlugin',
    },
    {
      href: docLink('/develop-plugin/getting-started/getting-started-dify-plugin'),
      icon: <RiBookOpenLine className="h-4 w-4 shrink-0 text-text-tertiary" />,
      labelKey: 'pluginDevelopmentGuide',
    },
    {
      href: docLink('/develop-plugin/publishing/marketplace-listing/release-overview'),
      icon: <RiBookOpenLine className="h-4 w-4 shrink-0 text-text-tertiary" />,
      labelKey: 'pluginPublishGuide',
    },
    {
      href: MARKETPLACE_URL_PREFIX.replace('marketplace', 'creators'),
      icon: <RiBookOpenLine className="h-4 w-4 shrink-0 text-text-tertiary" />,
      labelKey: 'templatePublishingGuide',
    },
  ]
}

type SubmitRequestDropdownProps = {
  dividerAfterFirst?: boolean
}

export const SubmitRequestDropdown = ({ dividerAfterFirst }: SubmitRequestDropdownProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const docLink = useDocLink()
  const options = getOptions(docLink)

  return (
    <PortalToFollowElem
      placement="bottom-start"
      offset={4}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <Button
          variant="ghost"
          className={cn(
            'flex items-center gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            open && 'bg-state-base-hover text-text-secondary',
          )}
        >
          {/* <RiAddLine className="h-4 w-4 shrink-0 lg:hidden" />
          <span className="hidden system-sm-medium lg:inline">
            {t('requestSubmit', { ns: 'plugin' })}
          </span> */}
          <RiBookOpenLine className="h-4 w-4 shrink-0 text-text-tertiary" />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000] min-w-[200px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-sm">
        {options.map((option, index) => (
          <Fragment key={option.href}>
            {dividerAfterFirst && index === 1 && (
              <div className="my-1 h-px bg-divider-regular" />
            )}
            <DropdownItem
              href={option.href}
              icon={option.icon}
              text={t(option.labelKey, { ns: 'plugin' })}
              onClick={() => setOpen(false)}
            />
          </Fragment>
        ))}
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export const CreationTypeTabs = () => {
  const { t } = useTranslation()
  const creationType = useCreationType()

  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/${CREATION_TYPE.plugins}`}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'flex items-center gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          creationType === CREATION_TYPE.plugins && 'bg-state-base-hover text-text-secondary',
        )}
      >
        <Plugin className="h-4 w-4 shrink-0" />
        <span className="hidden system-sm-medium md:inline">
          {t('plugins', { ns: 'plugin' })}
        </span>
      </Link>
      <Link
        href={`/${CREATION_TYPE.templates}`}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'flex items-center gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          creationType === CREATION_TYPE.templates && 'bg-state-base-hover text-text-secondary',
        )}
      >
        <Playground className="h-4 w-4 shrink-0" />
        <span className="hidden system-sm-medium md:inline">
          {t('templates', { ns: 'plugin' })}
        </span>
        <Badge className="ml-1 hidden h-4 rounded-[4px] border-none bg-saas-dify-blue-accessible px-1 text-[10px] font-bold leading-[14px] text-text-primary-on-surface md:inline-flex">
          {t('badge.new', { ns: 'plugin' })}
        </Badge>
      </Link>
    </div>
  )
}

const CreatorCenterIcon = () => (
  <svg width="15" height="13" viewBox="0 0 15 13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.9898 0.2886C11.9712 0.12434 11.8323 0.000166835 11.667 1.67973e-07C11.5017 -0.000166499 11.3625 0.123714 11.3436 0.28794C11.2253 1.31329 10.6466 1.89201 9.62127 2.01027C9.45707 2.02921 9.33313 2.16835 9.33333 2.33367C9.33353 2.49898 9.45767 2.63787 9.62193 2.65647C10.6327 2.77097 11.2516 3.34411 11.3427 4.37024C11.3577 4.53817 11.4985 4.66685 11.667 4.66667C11.8356 4.66647 11.9761 4.53747 11.9907 4.36951C12.0782 3.35789 12.6912 2.74489 13.7029 2.65733C13.8708 2.64279 13.9998 2.50229 14 2.3337C14.0002 2.16511 13.8715 2.02432 13.7036 2.00941C12.6775 1.91825 12.1043 1.29941 11.9898 0.2886Z" fill="#676F83" />
    <path d="M6.83333 3.66667C6.83333 2.74619 6.08714 2 5.16667 2C4.24619 2 3.5 2.74619 3.5 3.66667C3.5 4.58714 4.24619 5.33333 5.16667 5.33333C6.08714 5.33333 6.83333 4.58714 6.83333 3.66667ZM8.16667 3.66667C8.16667 5.32352 6.82352 6.66667 5.16667 6.66667C3.50981 6.66667 2.16667 5.32352 2.16667 3.66667C2.16667 2.00981 3.50981 0.666667 5.16667 0.666667C6.82352 0.666667 8.16667 2.00981 8.16667 3.66667Z" fill="#676F83" />
    <path d="M0 12C0 9.42268 2.08934 7.33333 4.66667 7.33333H5C5.36819 7.33333 5.66667 7.63181 5.66667 8C5.66667 8.36819 5.36819 8.66667 5 8.66667H4.66667C2.82572 8.66667 1.33333 10.1591 1.33333 12C1.33333 12.3682 1.03486 12.6667 0.666667 12.6667C0.298477 12.6667 0 12.3682 0 12Z" fill="#676F83" />
    <path d="M13.028 6.66667C13.9581 6.66679 14.6291 7.55698 14.3737 8.45117L13.446 11.6999C13.2824 12.2721 12.7592 12.6666 12.1641 12.6667H4C3.63181 12.6667 3.33333 12.3682 3.33333 12C3.33333 11.6318 3.63181 11.3333 4 11.3333H6.16341L7.15169 7.87565C7.35613 7.16024 8.01033 6.66667 8.75456 6.66667H13.028ZM8.75456 8C8.60577 8 8.47454 8.0985 8.43359 8.24154L7.55078 11.3333H12.1641L13.0918 8.08529C13.104 8.04267 13.0721 8.00012 13.028 8H8.75456Z" fill="#676F83" />
  </svg>
)

export const CreatorCenter = () => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-1">
      <Link href="https://creators.dify.ai/" target="_blank" rel="noopener noreferrer">
        <Button variant="ghost" className="flex items-center gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary">
          <CreatorCenterIcon />
          <span className="hidden system-sm-medium lg:inline">
            {t('creatorCenter', { ns: 'plugin' })}
          </span>
        </Button>
      </Link>
    </div>
  )
}
