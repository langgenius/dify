import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'

// Mock component since VoiceInput requires browser APIs and service dependencies
const VoiceInputMock = ({ onConverted, onCancel }: any) => {
  const [state, setState] = useState<'idle' | 'recording' | 'converting'>('recording')
  const [duration, setDuration] = useState(0)

  // Simulate recording
  useState(() => {
    const interval = setInterval(() => {
      setDuration(d => d + 1)
    }, 1000)
    return () => clearInterval(interval)
  })

  const handleStop = () => {
    setState('converting')
    setTimeout(() => {
      onConverted('This is simulated transcribed text from voice input.')
    }, 2000)
  }

  const minutes = Math.floor(duration / 60)
  const seconds = duration % 60

  return (
    <div className="relative h-16 w-full overflow-hidden rounded-xl border-2 border-primary-600">
      <div className="absolute inset-[1.5px] flex items-center overflow-hidden rounded-[10.5px] bg-primary-25 py-[14px] pl-[14.5px] pr-[6.5px]">
        {/* Waveform visualization placeholder */}
        <div className="absolute bottom-0 left-0 flex h-4 w-full items-end gap-[3px] px-2">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="w-[2px] rounded-t bg-blue-200"
              style={{
                height: `${Math.random() * 100}%`,
                animation: state === 'recording' ? 'pulse 1s infinite' : 'none',
              }}
            />
          ))}
        </div>

        {state === 'converting' && (
          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-700 border-t-transparent" />
        )}

        <div className="z-10 grow">
          {state === 'recording' && (
            <div className="text-sm text-gray-500">Speaking...</div>
          )}
          {state === 'converting' && (
            <div className="text-sm text-gray-500">Converting to text...</div>
          )}
        </div>

        {state === 'recording' && (
          <div
            className="mr-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-primary-100"
            onClick={handleStop}
          >
            <div className="h-5 w-5 rounded bg-primary-600" />
          </div>
        )}

        {state === 'converting' && (
          <div
            className="mr-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-gray-200"
            onClick={onCancel}
          >
            <span className="text-lg text-gray-500">×</span>
          </div>
        )}

        <div className={`w-[45px] pl-1 text-xs font-medium ${duration > 500 ? 'text-red-600' : 'text-gray-700'}`}>
          {`0${minutes}:${seconds >= 10 ? seconds : `0${seconds}`}`}
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Base/Data Entry/VoiceInput',
  component: VoiceInputMock,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Voice input component for recording audio and converting speech to text. Features waveform visualization, recording timer (max 10 minutes), and audio-to-text conversion using js-audio-recorder.\n\n**Note:** This is a simplified mock for Storybook. The actual component requires microphone permissions and audio-to-text API.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof VoiceInputMock>

export default meta
type Story = StoryObj<typeof meta>

// Basic demo
const VoiceInputDemo = () => {
  const [isRecording, setIsRecording] = useState(false)
  const [transcription, setTranscription] = useState('')

  const handleStartRecording = () => {
    setIsRecording(true)
    setTranscription('')
  }

  const handleConverted = (text: string) => {
    setTranscription(text)
    setIsRecording(false)
  }

  const handleCancel = () => {
    setIsRecording(false)
    setTranscription('')
  }

  return (
    <div style={{ width: '600px' }}>
      {!isRecording && (
        <button
          className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
          onClick={handleStartRecording}
        >
          🎤 Start Voice Recording
        </button>
      )}

      {isRecording && (
        <VoiceInputMock
          onConverted={handleConverted}
          onCancel={handleCancel}
        />
      )}

      {transcription && (
        <div className="mt-4 rounded-lg bg-gray-50 p-4">
          <div className="mb-2 text-xs font-medium text-gray-600">Transcription:</div>
          <div className="text-sm text-gray-800">{transcription}</div>
        </div>
      )}
    </div>
  )
}

// Default state
export const Default: Story = {
  render: () => <VoiceInputDemo />,
}

// Recording state
export const RecordingState: Story = {
  render: () => (
    <div style={{ width: '600px' }}>
      <VoiceInputMock
        onConverted={() => console.log('Converted')}
        onCancel={() => console.log('Cancelled')}
      />
      <div className="mt-3 text-xs text-gray-500">
        Recording in progress with live waveform visualization
      </div>
    </div>
  ),
}

// Real-world example - Chat input with voice
const ChatInputWithVoiceDemo = () => {
  const [message, setMessage] = useState('')
  const [isRecording, setIsRecording] = useState(false)

  return (
    <div style={{ width: '700px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Chat Interface</h3>

      {/* Existing messages */}
      <div className="mb-4 h-64 space-y-3 overflow-y-auto">
        <div className="flex gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-sm text-white">
            U
          </div>
          <div className="flex-1">
            <div className="rounded-lg bg-gray-100 p-3 text-sm">
              Hello! How can I help you today?
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-sm text-white">
            A
          </div>
          <div className="flex-1">
            <div className="rounded-lg bg-blue-50 p-3 text-sm">
              I can assist you with various tasks. What would you like to know?
            </div>
          </div>
        </div>
      </div>

      {/* Input area */}
      <div className="space-y-3">
        {!isRecording
          ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm"
                  placeholder="Type a message..."
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                />
                <button
                  className="rounded-lg bg-gray-100 px-4 py-3 hover:bg-gray-200"
                  onClick={() => setIsRecording(true)}
                  title="Voice input"
                >
                  🎤
                </button>
                <button className="rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700">
                  Send
                </button>
              </div>
            )
          : (
              <VoiceInputMock
                onConverted={(text: string) => {
                  setMessage(text)
                  setIsRecording(false)
                }}
                onCancel={() => setIsRecording(false)}
              />
            )}
      </div>
    </div>
  )
}

export const ChatInputWithVoice: Story = {
  render: () => <ChatInputWithVoiceDemo />,
}

// Real-world example - Search with voice
const SearchWithVoiceDemo = () => {
  const [searchQuery, setSearchQuery] = useState('')
  const [isRecording, setIsRecording] = useState(false)

  return (
    <div style={{ width: '700px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Voice Search</h3>

      {!isRecording
        ? (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 pl-10 text-sm"
                  placeholder="Search or use voice..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  🔍
                </span>
              </div>
              <button
                className="rounded-lg bg-blue-600 px-4 py-3 text-white hover:bg-blue-700"
                onClick={() => setIsRecording(true)}
              >
                🎤 Voice Search
              </button>
            </div>
          )
        : (
            <VoiceInputMock
              onConverted={(text: string) => {
                setSearchQuery(text)
                setIsRecording(false)
              }}
              onCancel={() => setIsRecording(false)}
            />
          )}

      {searchQuery && !isRecording && (
        <div className="mt-4 rounded-lg bg-blue-50 p-4">
          <div className="mb-2 text-xs font-medium text-blue-900">
            Searching for:
            {' '}
            <strong>{searchQuery}</strong>
          </div>
        </div>
      )}
    </div>
  )
}

export const SearchWithVoice: Story = {
  render: () => <SearchWithVoiceDemo />,
}

// Real-world example - Note taking
const NoteTakingDemo = () => {
  const [notes, setNotes] = useState<string[]>([])
  const [isRecording, setIsRecording] = useState(false)

  return (
    <div style={{ width: '700px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Voice Notes</h3>
        <span className="text-sm text-gray-500">
          {notes.length}
          {' '}
          notes
        </span>
      </div>

      <div className="mb-4">
        {!isRecording
          ? (
              <button
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-3 font-medium text-white hover:bg-red-600"
                onClick={() => setIsRecording(true)}
              >
                <span className="text-xl">🎤</span>
                Record Voice Note
              </button>
            )
          : (
              <VoiceInputMock
                onConverted={(text: string) => {
                  setNotes([...notes, text])
                  setIsRecording(false)
                }}
                onCancel={() => setIsRecording(false)}
              />
            )}
      </div>

      <div className="max-h-80 space-y-2 overflow-y-auto">
        {notes.length === 0
          ? (
              <div className="py-12 text-center text-gray-400">
                No notes yet. Click the button above to start recording.
              </div>
            )
          : (
              notes.map((note, index) => (
                <div key={index} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-1 text-xs text-gray-500">
                        Note
                        {index + 1}
                      </div>
                      <div className="text-sm text-gray-800">{note}</div>
                    </div>
                    <button
                      className="text-gray-400 hover:text-red-500"
                      onClick={() => setNotes(notes.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
      </div>
    </div>
  )
}

export const NoteTaking: Story = {
  render: () => <NoteTakingDemo />,
}

// Real-world example - Form with voice
const FormWithVoiceDemo = () => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  })
  const [activeField, setActiveField] = useState<'name' | 'description' | null>(null)

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Create Product</h3>

      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Product Name
          </label>
          {activeField === 'name'
            ? (
                <VoiceInputMock
                  onConverted={(text: string) => {
                    setFormData({ ...formData, name: text })
                    setActiveField(null)
                  }}
                  onCancel={() => setActiveField(null)}
                />
              )
            : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Enter product name..."
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                  />
                  <button
                    className="rounded-lg bg-gray-100 px-3 py-2 hover:bg-gray-200"
                    onClick={() => setActiveField('name')}
                  >
                    🎤
                  </button>
                </div>
              )}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Description
          </label>
          {activeField === 'description'
            ? (
                <VoiceInputMock
                  onConverted={(text: string) => {
                    setFormData({ ...formData, description: text })
                    setActiveField(null)
                  }}
                  onCancel={() => setActiveField(null)}
                />
              )
            : (
                <div className="space-y-2">
                  <textarea
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    rows={4}
                    placeholder="Enter product description..."
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                  />
                  <button
                    className="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200"
                    onClick={() => setActiveField('description')}
                  >
                    🎤 Use Voice Input
                  </button>
                </div>
              )}
        </div>

        <button className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
          Create Product
        </button>
      </div>
    </div>
  )
}

export const FormWithVoice: Story = {
  render: () => <FormWithVoiceDemo />,
}

// Features showcase
export const FeaturesShowcase: Story = {
  render: () => (
    <div style={{ width: '700px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Voice Input Features</h3>

      <div className="mb-6">
        <VoiceInputMock
          onConverted={() => undefined}
          onCancel={() => undefined}
        />
      </div>

      <div className="space-y-4">
        <div className="rounded-lg bg-blue-50 p-4">
          <div className="mb-2 text-sm font-medium text-blue-900">🎤 Audio Recording</div>
          <ul className="space-y-1 text-xs text-blue-800">
            <li>• Uses js-audio-recorder for browser-based recording</li>
            <li>• 16kHz sample rate, 16-bit, mono channel</li>
            <li>• Converts to MP3 format for transmission</li>
          </ul>
        </div>

        <div className="rounded-lg bg-green-50 p-4">
          <div className="mb-2 text-sm font-medium text-green-900">📊 Waveform Visualization</div>
          <ul className="space-y-1 text-xs text-green-800">
            <li>• Real-time audio level display using Canvas API</li>
            <li>• Animated bars showing voice amplitude</li>
            <li>• Visual feedback during recording</li>
          </ul>
        </div>

        <div className="rounded-lg bg-purple-50 p-4">
          <div className="mb-2 text-sm font-medium text-purple-900">⏱️ Time Limits</div>
          <ul className="space-y-1 text-xs text-purple-800">
            <li>• Maximum recording duration: 10 minutes (600 seconds)</li>
            <li>• Timer turns red after 8:20 (500 seconds)</li>
            <li>• Automatic stop at max duration</li>
          </ul>
        </div>

        <div className="rounded-lg bg-orange-50 p-4">
          <div className="mb-2 text-sm font-medium text-orange-900">🔄 Audio-to-Text Conversion</div>
          <ul className="space-y-1 text-xs text-orange-800">
            <li>• Server-side speech-to-text processing</li>
            <li>• Optional word timestamps support</li>
            <li>• Loading state during conversion</li>
          </ul>
        </div>
      </div>
    </div>
  ),
}
