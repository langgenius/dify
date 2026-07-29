import type { MockDeploymentCredential } from '../mock-data'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import githubIcon from '../assets/github.png'
import moonshotIcon from '../assets/moonshot.png'
import slackIcon from '../assets/slack.png'

// todo: mock data for plugin icon, need to replace with real data when plugin icon is available
const CREDENTIAL_ICONS = {
  github: githubIcon,
  moonshot: moonshotIcon,
  slack: slackIcon,
} satisfies Record<MockDeploymentCredential['id'], typeof githubIcon>

export function CredentialField({
  credential,
  value,
  onChange,
}: {
  credential: MockDeploymentCredential
  value: string
  onChange: (value: string) => void
}) {
  const selectedOption = credential.options.find((option) => option.value === value)
  const icon = CREDENTIAL_ICONS[credential.id]

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="size-5 shrink-0 overflow-hidden rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge">
          <img alt="" src={icon.src} className="size-full object-cover" />
        </span>
        <span className="system-sm-medium text-text-primary">{credential.name}</span>
        <span className="system-xs-regular text-text-tertiary">{credential.category}</span>
      </div>
      <Select
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue) onChange(nextValue)
        }}
      >
        <SelectTrigger aria-label={credential.name} className="px-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="flex size-4 shrink-0 items-center justify-center">
              <span className="size-2 rounded-[3px] border border-components-badge-status-light-success-border-inner bg-components-badge-status-light-success-bg shadow-status-indicator-green-shadow" />
            </span>
            <span className="truncate">{selectedOption?.label}</span>
          </span>
        </SelectTrigger>
        <SelectContent popupClassName="w-(--anchor-width)">
          {credential.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <SelectItemText>{option.label}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
