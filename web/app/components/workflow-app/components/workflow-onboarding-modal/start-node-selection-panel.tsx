'use client'
import type { FC } from 'react'
import StartNodeOption from './start-node-option'

type StartNodeSelectionPanelProps = {
  onSelectUserInput: () => void
  onSelectTrigger: () => void
}

const StartNodeSelectionPanel: FC<StartNodeSelectionPanelProps> = ({
  onSelectUserInput,
  onSelectTrigger,
}) => {
  return (
    <div className="flex flex-col items-center p-8">
      <h2 className="title-xl-semi-bold mb-2 text-text-primary">
        Select a start node to begin
      </h2>
      <p className="body-md-regular mb-8 max-w-md text-center text-text-secondary">
        Different start nodes have different capabilities. Don't worry, you can always change them later.{' '}
        <a href="#" className="text-text-accent hover:underline">
          Learn more about start node.
        </a>
      </p>

      <div className="flex gap-6">
        <StartNodeOption
          icon={
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-util-colors-blue-blue-500">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 2.66669L18.16 11.84H27.3334L20.5867 16.8267L22.7467 26L16 21.0134L9.25334 26L11.4133 16.8267L4.66668 11.84H13.84L16 2.66669Z" fill="white"/>
              </svg>
            </div>
          }
          title="User Input"
          subtitle="(original start node)"
          description="Start node that allows setting user input variables, with web app, service API, MCP server, and workflow as tool capabilities."
          onClick={onSelectUserInput}
        />

        <StartNodeOption
          icon={
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-util-colors-blue-blue-500">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 4L20 12L28 16L20 20L16 28L12 20L4 16L12 12L16 4Z" fill="white"/>
              </svg>
            </div>
          }
          title="Trigger"
          description="Triggers can serve as the start node of a workflow, such as scheduled tasks, custom webhooks, or integrations with other apps."
          onClick={onSelectTrigger}
        />
      </div>
    </div>
  )
}

export default StartNodeSelectionPanel
