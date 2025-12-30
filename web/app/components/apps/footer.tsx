import { RiDiscordFill, RiDiscussLine, RiGithubFill } from '@remixicon/react'
import Link from 'next/link'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type CustomLinkProps = {
  href: string
  children: React.ReactNode
}

const CustomLink = React.memo(({
  href,
  children,
}: CustomLinkProps) => {
  return (
    <Link
      className="flex h-8 w-8 cursor-pointer items-center justify-center transition-opacity duration-200 ease-in-out hover:opacity-80"
      target="_blank"
      rel="noopener noreferrer"
      href={href}
    >
      {children}
    </Link>
  )
})

const Footer = () => {
  const { t } = useTranslation()

  return (
    <footer className="relative shrink-0 grow-0 px-12 py-2">
      <h3 className="text-gradient text-xl font-semibold leading-tight">{t('join', { ns: 'app' })}</h3>
      <p className="system-sm-regular mt-1 text-text-tertiary">{t('communityIntro', { ns: 'app' })}</p>
      <div className="mt-3 flex items-center gap-2">
        <CustomLink href="https://github.com/langgenius/dify">
          <RiGithubFill className="h-5 w-5 text-text-tertiary" />
        </CustomLink>
        <CustomLink href="https://discord.gg/FngNHpbcY7">
          <RiDiscordFill className="h-5 w-5 text-text-tertiary" />
        </CustomLink>
        <CustomLink href="https://forum.dify.ai">
          <RiDiscussLine className="h-5 w-5 text-text-tertiary" />
        </CustomLink>
      </div>
    </footer>
  )
}

export default React.memo(Footer)
