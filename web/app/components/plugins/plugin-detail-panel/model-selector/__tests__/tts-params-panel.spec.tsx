import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TTSParamsPanel from '../tts-params-panel'

vi.mock('@/i18n-config/language', () => ({
  languages: [
    { value: 'en-US', name: 'English', supported: true },
    { value: 'zh-Hans', name: 'Chinese', supported: true },
    { value: 'unsupported', name: 'Unsupported', supported: false },
  ],
}))

const model = {
  model_properties: {
    voices: [
      { mode: 'alloy', name: 'Alloy' },
      { mode: 'echo', name: 'Echo' },
    ],
  },
}

describe('TTSParamsPanel', () => {
  it('renders the selected language and voice', () => {
    render(
      <TTSParamsPanel currentModel={model} language="en-US" voice="alloy" onChange={vi.fn()} />,
    )

    expect(
      screen.getByRole('combobox', { name: 'appDebug.voice.voiceSettings.language' }),
    ).toHaveTextContent('en-US')
    expect(
      screen.getByRole('combobox', { name: 'appDebug.voice.voiceSettings.voice' }),
    ).toHaveTextContent('alloy')
  })

  it('only exposes supported languages and preserves the selected voice', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TTSParamsPanel currentModel={model} language="en-US" voice="alloy" onChange={onChange} />,
    )

    await user.click(
      screen.getByRole('combobox', { name: 'appDebug.voice.voiceSettings.language' }),
    )
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).queryByRole('option', { name: 'Unsupported' })).not.toBeInTheDocument()
    await user.click(within(listbox).getByRole('option', { name: 'Chinese' }))

    expect(onChange).toHaveBeenCalledWith('zh-Hans', 'alloy')
  })

  it('changes the voice while preserving the selected language', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TTSParamsPanel currentModel={model} language="en-US" voice="alloy" onChange={onChange} />,
    )

    await user.click(screen.getByRole('combobox', { name: 'appDebug.voice.voiceSettings.voice' }))
    await user.click(await screen.findByRole('option', { name: 'Echo' }))

    expect(onChange).toHaveBeenCalledWith('en-US', 'echo')
  })

  it('renders an empty voice list without a model', async () => {
    render(<TTSParamsPanel currentModel={null} language="en-US" voice="" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'appDebug.voice.voiceSettings.voice' }))

    expect(await screen.findByRole('listbox')).toBeEmptyDOMElement()
  })
})
