const Title = ({
  title,
}: {
  title: string
}) => {
  return (
    <div className="truncate system-md-semibold text-text-secondary">
      {title}
    </div>
  )
}

export default Title
