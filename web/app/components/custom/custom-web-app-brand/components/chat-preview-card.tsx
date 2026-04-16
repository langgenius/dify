import { cn } from '@langgenius/dify-ui/cn'
import { Button } from '@/app/components/base/ui/button'
import PoweredByBrand from './powered-by-brand'

type ChatPreviewCardProps = {
  webappBrandRemoved?: boolean
  workspaceLogo?: string
  webappLogo?: string
  imgKey: number
}

const ChatPreviewCard = ({
  webappBrandRemoved,
  workspaceLogo,
  webappLogo,
  imgKey,
}: ChatPreviewCardProps) => {
  return (
    <div className="flex h-[320px] grow basis-1/2 overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-background-default-burn">
      <div className="flex h-full w-[232px] shrink-0 flex-col p-1 pr-0">
        <div className="flex items-center gap-3 p-3 pr-2">
          <div className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg border border-divider-regular', 'bg-components-icon-bg-blue-light-solid')}>
            <span className="i-custom-vender-solid-communication-bubble-text-mod h-4 w-4 text-components-avatar-shape-fill-stop-100" />
          </div>
          <div className="grow system-md-semibold text-text-secondary">Chatflow App</div>
          <div className="p-1.5">
            <span className="i-ri-layout-left-2-line h-4 w-4 text-text-tertiary" />
          </div>
        </div>
        <div className="shrink-0 px-4 py-3">
          <Button variant="secondary-accent" className="w-full justify-center">
            <span className="mr-1 i-ri-edit-box-line h-4 w-4" />
            <div className="p-1 opacity-20">
              <div className="h-2 w-[94px] rounded-xs bg-text-accent-light-mode-only"></div>
            </div>
          </Button>
        </div>
        <div className="grow px-3 pt-5">
          <div className="flex h-8 items-center px-3 py-1">
            <div className="h-2 w-14 rounded-xs bg-text-quaternary opacity-20"></div>
          </div>
          <div className="flex h-8 items-center px-3 py-1">
            <div className="h-2 w-[168px] rounded-xs bg-text-quaternary opacity-20"></div>
          </div>
          <div className="flex h-8 items-center px-3 py-1">
            <div className="h-2 w-[128px] rounded-xs bg-text-quaternary opacity-20"></div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between p-3">
          <div className="p-1.5">
            <span className="i-ri-equalizer-2-line h-4 w-4 text-text-tertiary" />
          </div>
          <div className="flex items-center gap-1.5">
            <PoweredByBrand
              webappBrandRemoved={webappBrandRemoved}
              workspaceLogo={workspaceLogo}
              webappLogo={webappLogo}
              imgKey={imgKey}
            />
          </div>
        </div>
      </div>
      <div className="flex w-[138px] grow flex-col justify-between p-2 pr-0">
        <div className="flex grow flex-col justify-between rounded-l-2xl border-[0.5px] border-r-0 border-components-panel-border-subtle bg-chatbot-bg pt-16 pb-4 pl-[22px]">
          <div className="w-[720px] rounded-2xl border border-divider-subtle bg-chat-bubble-bg px-4 py-3">
            <div className="mb-1 body-md-regular text-text-primary">Hello! How can I assist you today?</div>
            <Button size="small">
              <div className="h-2 w-[144px] rounded-xs bg-text-quaternary opacity-20"></div>
            </Button>
          </div>
          <div className="flex h-[52px] w-[578px] items-center rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur pl-3.5 body-lg-regular text-text-placeholder shadow-md backdrop-blur-xs">Talk to Dify</div>
        </div>
      </div>
    </div>
  )
}

export default ChatPreviewCard
