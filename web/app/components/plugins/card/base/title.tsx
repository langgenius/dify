const Title = ({
  title,
}: {
  title: string
}) => {
  return (
    <div className='truncate text-text-secondary system-md-semibold'>
      {title}
    </div>
  )
}

export default Title
