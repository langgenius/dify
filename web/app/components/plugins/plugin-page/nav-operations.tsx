'use client'

import type { ReactNode } from 'react'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Menu,
  MenuContent,
  MenuLinkItem,
  MenuSeparator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MARKETPLACE_URL_PREFIX } from '@/config'
import { useDocLink } from '@/context/i18n'

type GuideMenuItemProps = {
  href: string
  icon: ReactNode
  text: string
}

function GuideMenuItem({ href, icon, text }: GuideMenuItemProps) {
  return (
    <MenuLinkItem
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="gap-2 rounded-lg px-3 py-2"
    >
      {icon}
      <span className="system-sm-medium text-text-secondary">{text}</span>
      <span className="ml-auto i-ri-arrow-right-up-line size-4 shrink-0 text-text-tertiary" />
    </MenuLinkItem>
  )
}

type OptionLabelKey =
  | 'requestAPlugin'
  | 'pluginDevelopmentGuide'
  | 'pluginPublishGuide'
  | 'templatePublishingGuide'

function getOptions(docLink: (path: DocPathWithoutLang) => string): {
  href: string
  icon: ReactNode
  labelKey: OptionLabelKey
}[] {
  return [
    {
      href: 'https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml',
      icon: <span className="i-ri-plug-line size-4 shrink-0 text-text-tertiary" />,
      labelKey: 'requestAPlugin',
    },
    {
      href: docLink('/develop-plugin/getting-started/getting-started-dify-plugin'),
      icon: <span className="i-ri-book-open-line size-4 shrink-0 text-text-tertiary" />,
      labelKey: 'pluginDevelopmentGuide',
    },
    {
      href: docLink('/develop-plugin/publishing/marketplace-listing/release-overview'),
      icon: <span className="i-ri-book-open-line size-4 shrink-0 text-text-tertiary" />,
      labelKey: 'pluginPublishGuide',
    },
    {
      href: MARKETPLACE_URL_PREFIX.replace('marketplace', 'creators'),
      icon: <span className="i-ri-book-open-line size-4 shrink-0 text-text-tertiary" />,
      labelKey: 'templatePublishingGuide',
    },
  ]
}

type SubmitRequestMenuProps = {
  dividerAfterFirst?: boolean
}

type SubmitRequestMenuViewProps = SubmitRequestMenuProps & {
  docLink: (path: DocPathWithoutLang) => string
}

// Presentational menu. Callers that cannot use useDocLink() -- standalone
// Marketplace SSR -- pass a locale-composed docLink instead.
export function SubmitRequestMenuView({ dividerAfterFirst, docLink }: SubmitRequestMenuViewProps) {
  const { t } = useTranslation(['plugin'])
  const [open, setOpen] = useState(false)
  const options = getOptions(docLink)
  const guideLabel = t(($) => $['marketplace.home.guide'], { ns: 'plugin' })

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip disabled={open}>
        <MenuTrigger
          render={
            <TooltipTrigger
              render={
                <IconButton
                  aria-label={guideLabel}
                  size="lg"
                  className="data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary"
                >
                  <span aria-hidden className="i-ri-book-open-line size-4 shrink-0" />
                </IconButton>
              }
            />
          }
        />
        <TooltipContent side="bottom" role="tooltip">
          {guideLabel}
        </TooltipContent>
      </Tooltip>
      <MenuContent className="min-w-50">
        {options.map((option, index) => (
          <Fragment key={option.href}>
            {dividerAfterFirst && index === 1 && <MenuSeparator className="my-1" />}
            <GuideMenuItem
              href={option.href}
              icon={option.icon}
              text={t(($) => $[option.labelKey], { ns: 'plugin' })}
            />
          </Fragment>
        ))}
      </MenuContent>
    </Menu>
  )
}

export function SubmitRequestMenu({ dividerAfterFirst }: SubmitRequestMenuProps) {
  const docLink = useDocLink()
  return <SubmitRequestMenuView dividerAfterFirst={dividerAfterFirst} docLink={docLink} />
}
