import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'

export function PlanFeatureInfotip({ label, content }: { label: string; content: string }) {
  if (!content) return null

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={0}
        closeDelay={0}
        render={
          <IconButton
            aria-label={content}
            variant="default"
            size="xs"
            className="group relative z-10 size-4.5 rounded-sm border-0 bg-state-base-hover p-0 transition-[border-radius,background-color] duration-500 ease-in-out hover:rounded-none hover:bg-saas-dify-blue-static data-popup-open:rounded-none data-popup-open:bg-saas-dify-blue-static motion-reduce:transition-none"
          >
            <span
              aria-hidden
              className="i-ri-info-i size-3.5 text-text-tertiary group-hover:text-text-primary-on-surface group-data-popup-open:text-text-primary-on-surface"
            />
          </IconButton>
        }
      />
      <PopoverContent
        placement="top-end"
        className="w-65 rounded-none border-0 bg-saas-dify-blue-static px-5 py-4.5 system-xs-regular text-text-primary-on-surface shadow-none"
      >
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        {content}
      </PopoverContent>
    </Popover>
  )
}
