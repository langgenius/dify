type LinkProps = {
  Icon: React.ComponentType<{ className?: string }>
  text: string
  href: string
  ref?: React.RefObject<HTMLAnchorElement>
}

const Link = ({
  Icon,
  text,
  href,
  ref,
}: LinkProps) => {
  return (
    <a
      ref={ref}
      className='flex w-full items-center gap-x-2 rounded-lg bg-transparent px-4 py-2 text-text-tertiary shadow-shadow-shadow-3 hover:bg-background-default-dodge hover:text-text-secondary hover:shadow-xs'
      href={href}
    >
      <Icon className='h-4 w-4' />
      <span className='system-sm-medium'>{text}</span>
    </a>
  )
}

export default Link
