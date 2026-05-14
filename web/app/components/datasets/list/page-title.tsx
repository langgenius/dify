type Props = {
  description: string
  title: string
  titleClassName?: string
}

const DatasetListPageTitle = ({
  description,
  title,
  titleClassName = 'text-text-primary',
}: Props) => {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <h1 className={`text-xl/6 font-semibold ${titleClassName}`}>{title}</h1>
      <p className="truncate system-sm-regular text-text-tertiary">{description}</p>
    </div>
  )
}

export default DatasetListPageTitle
