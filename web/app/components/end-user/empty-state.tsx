type Props = {
  title: string
  description: string
}

export default function EmptyState({ title, description }: Props) {
  return (
    <div className="flex min-h-75 w-full flex-col items-center justify-center gap-3 text-center text-text-tertiary">
      <h2 className="min-h-10 w-full max-w-175 shrink-0 text-xl leading-4.5 font-normal wrap-anywhere">
        {title}
      </h2>
      <p className="min-h-10 w-full max-w-175 shrink-0 system-sm-regular leading-4.5 wrap-anywhere">
        {description}
      </p>
    </div>
  )
}
