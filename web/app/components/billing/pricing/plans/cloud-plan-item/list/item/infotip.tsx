import { Infotip, InfotipContent, InfotipTitle, InfotipTrigger } from '@langgenius/dify-ui/infotip'

export function PlanFeatureInfotip({ label, content }: { label: string; content: string }) {
  if (!content) return null

  return (
    <Infotip>
      <InfotipTrigger aria-label={content} iconVariant="information" size="md" />
      <InfotipContent align="end" className="w-65">
        <InfotipTitle className="sr-only">{label}</InfotipTitle>
        {content}
      </InfotipContent>
    </Infotip>
  )
}
