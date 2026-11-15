export function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <h3 className="system-md-semibold text-text-primary">{title}</h3>
      <p className="system-xs-regular text-text-tertiary">{description}</p>
    </div>
  )
}
