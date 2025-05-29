import { useRouter } from 'next/navigation'
import React from 'react'

type LinkProps = {
  Icon: React.ComponentType<{ className?: string }>
  text: string
  href: string
}

const Link = ({
  Icon,
  text,
  href,
}: LinkProps) => {
  const { push } = useRouter()

  const navigateTo = () => {
    push(href)
  }

  return (
    <button
      type='button'
      className='flex w-full items-center gap-x-2 rounded-lg bg-transparent px-4 py-2 text-text-tertiary shadow-shadow-shadow-3 hover:bg-background-default-dodge hover:text-text-secondary hover:shadow-xs'
      onClick={navigateTo}
    >
      <Icon className='h-4 w-4 shrink-0' />
      <span className='system-sm-medium grow text-left'>{text}</span>
    </button>
  )
}

export default React.memo(Link)
