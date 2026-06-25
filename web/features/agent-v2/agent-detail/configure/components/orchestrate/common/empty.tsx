'use client'

export function ConfigureSectionEmpty({
  description,
  title,
}: {
  description: string
  title: string
}) {
  return (
    <div className="flex w-full flex-col items-start gap-1 rounded-xl bg-background-section p-3 text-text-tertiary">
      <p className="w-full system-xs-medium">
        {title}
      </p>
      <p className="w-full system-xs-regular">
        {description}
      </p>
    </div>
  )
}
