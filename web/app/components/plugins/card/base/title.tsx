const Title = ({
  title,
}: {
  title: string
}) => {
  return (
    <div className='max-w-[150px] truncate text-text-secondary system-md-semibold'>
      {title}
    </div>
  )
}

export default Title
