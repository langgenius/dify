import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ChatItem } from '../../types'
import type { AgentLogResponse } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { useEffect, useRef, useState } from 'react'
import Answer from '.'
import { upsertWorkflowToolActivity } from '../../workflow-agent-tool-activity'

type Scenario = 'success' | 'failure'

type ToolLogOptions = {
  id: string
  executionId: string
  nodeTitle: string
  label: string
  status: 'started' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  error?: string | null
  toolCallId: string
  toolName: string
  toolInput: string
  toolOutput?: string
}

const toolLog = ({
  id,
  executionId,
  nodeTitle,
  label,
  status,
  error = null,
  toolCallId,
  toolName,
  toolInput,
  toolOutput = '',
}: ToolLogOptions): AgentLogResponse['data'] => ({
  id,
  node_id: 'agent-node',
  node_execution_id: executionId,
  label,
  error,
  status,
  data: {
    tool_call_id: toolCallId,
    tool_name: toolName,
    tool_input: toolInput,
    tool_output: toolOutput,
    node_title: nodeTitle,
  },
  metadata: { agent_node_version: '2', kind: 'tool' },
})

const EMPTY_ITEM: ChatItem = { id: 'demo-answer', content: '', isAnswer: true }
const DEMO_QUESTION = 'Research Dify and list the files in the workspace'

function WorkflowToolActivityDemo({ scenario }: { scenario: Scenario }) {
  return <WorkflowToolActivityDemoInner key={scenario} scenario={scenario} />
}

function WorkflowToolActivityDemoInner({ scenario }: { scenario: Scenario }) {
  const [item, setItem] = useState<ChatItem>(EMPTY_ITEM)
  const [responding, setResponding] = useState(false)
  const [running, setRunning] = useState(false)
  const timersRef = useRef<number[]>([])
  const generationRef = useRef(0)

  const clearTimers = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    timersRef.current = []
  }

  const schedule = (generation: number, delay: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      if (generationRef.current === generation) run()
    }, delay)
    timersRef.current.push(timer)
  }

  const emitLog = (log: AgentLogResponse['data']) => {
    setItem((previous) => {
      const next: ChatItem = { ...previous }
      upsertWorkflowToolActivity(next, log)
      return next
    })
  }

  const appendText = (text: string) => {
    setItem((previous) => ({ ...previous, content: previous.content + text }))
  }

  const finishReplay = () => {
    setResponding(false)
    setRunning(false)
  }

  const runDemo = () => {
    clearTimers()
    const generation = ++generationRef.current
    setItem(EMPTY_ITEM)
    setResponding(true)
    setRunning(true)

    const searchA = {
      executionId: 'exec-research',
      nodeTitle: 'Research agent',
      toolName: 'web_search',
      toolInput: '{"q":"dify agent runtime"}',
    }
    const searchB = {
      executionId: 'exec-research',
      nodeTitle: 'Research agent',
      toolName: 'web_search',
      toolInput: '{"q":"dify workflow tools"}',
    }

    if (scenario === 'failure') {
      schedule(generation, 400, () =>
        emitLog(
          toolLog({
            ...searchA,
            id: 'run-demo:call-a',
            label: 'web_search',
            status: 'running',
            toolCallId: 'call-a',
          }),
        ),
      )
      schedule(generation, 1200, () =>
        emitLog(
          toolLog({
            ...searchA,
            id: 'run-demo:call-a',
            label: 'web_search',
            status: 'failed',
            error: 'Search provider timed out after 30s.',
            toolCallId: 'call-a',
          }),
        ),
      )
      const failureText = 'The search tool failed, so I could not complete the research.'
      failureText.split(' ').forEach((word, index) => {
        schedule(generation, 1800 + index * 160, () =>
          appendText(`${index === 0 ? '' : ' '}${word}`),
        )
      })
      schedule(generation, 1800 + failureText.split(' ').length * 160 + 300, finishReplay)
      return
    }

    schedule(generation, 400, () =>
      emitLog(
        toolLog({
          ...searchA,
          id: 'run-demo:call-a',
          label: 'web_search',
          status: 'running',
          toolCallId: 'call-a',
        }),
      ),
    )
    schedule(generation, 800, () =>
      emitLog(
        toolLog({
          ...searchB,
          id: 'run-demo:call-b',
          label: 'web_search',
          status: 'running',
          toolCallId: 'call-b',
        }),
      ),
    )
    schedule(generation, 1400, () =>
      emitLog(
        toolLog({
          ...searchB,
          id: 'run-demo:call-b',
          label: 'web_search',
          status: 'succeeded',
          toolCallId: 'call-b',
          toolOutput:
            'Dify Agent v2 runtime: tool calls stream as function_tool_call/result events.',
        }),
      ),
    )
    schedule(generation, 2000, () =>
      emitLog(
        toolLog({
          ...searchA,
          id: 'run-demo:call-a',
          label: 'web_search',
          status: 'succeeded',
          toolCallId: 'call-a',
          toolOutput: 'Chatflow UI renders live tool activity above the answer text.',
        }),
      ),
    )
    const shell = {
      executionId: 'exec-shell',
      nodeTitle: 'Shell agent',
      toolName: 'shell_run',
      id: 'run-demo:call-shell',
      label: 'shell_run',
      toolCallId: 'call-shell',
    }
    schedule(generation, 2600, () =>
      emitLog(
        toolLog({
          ...shell,
          toolInput: '{"script":"ls"}',
          status: 'started',
        }),
      ),
    )
    schedule(generation, 3200, () =>
      emitLog(
        toolLog({
          ...shell,
          toolInput: '{"script":"ls -la && wc -l notes.txt","timeout":30}',
          status: 'running',
        }),
      ),
    )
    schedule(generation, 4200, () =>
      emitLog(
        toolLog({
          ...shell,
          toolInput: '{"script":"ls -la && wc -l notes.txt","timeout":30}',
          status: 'succeeded',
          toolOutput:
            'total 8\ndrwxr-xr-x  2 demo  staff  64 Jan  1 00:00 .\n-rw-r--r--  1 demo  staff  21 Jan  1 00:00 notes.txt\n      42 notes.txt',
        }),
      ),
    )
    const answerText =
      'I searched the Dify documentation twice and listed the workspace files. Both tool calls completed successfully.'
    answerText.split(' ').forEach((word, index) => {
      schedule(generation, 4600 + index * 140, () => appendText(`${index === 0 ? '' : ' '}${word}`))
    })
    schedule(generation, 4600 + answerText.split(' ').length * 140 + 300, finishReplay)
  }

  const stopReplay = () => {
    clearTimers()
    generationRef.current += 1
    setResponding(false)
    setRunning(false)
  }

  const resetDemo = () => {
    stopReplay()
    setItem(EMPTY_ITEM)
  }

  useEffect(() => {
    return () => {
      generationRef.current += 1
      clearTimers()
    }
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <div className="flex items-center justify-between gap-4">
        <p className="system-xs-regular text-text-tertiary">
          Simulated event replay — no model or tools are executed
        </p>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="small" onClick={runDemo} disabled={running}>
            Run demo
          </Button>
          <Button variant="secondary" size="small" onClick={stopReplay} disabled={!running}>
            Stop
          </Button>
          <Button variant="secondary" size="small" onClick={resetDemo}>
            Reset
          </Button>
        </div>
      </div>
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-background-gradient-bg-fill-chat-bubble-bg-3 px-4 py-3 body-lg-regular text-text-primary">
          {DEMO_QUESTION}
        </div>
      </div>
      <Answer item={item} question={DEMO_QUESTION} index={0} responding={responding} />
    </div>
  )
}

const meta = {
  title: 'Base/Other/Chatflow Agent Tools',
  component: WorkflowToolActivityDemo,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    scenario: {
      control: 'select',
      options: ['success', 'failure'],
      description: 'Which simulated tool-call sequence to replay.',
    },
  },
  args: {
    scenario: 'success',
  },
} satisfies Meta<typeof WorkflowToolActivityDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
