import React, { useEffect } from 'react'

function useFeature({
  introduction,
  setIntroduction,
  moreLikeThis,
  setMoreLikeThis,
  suggestedQuestionsAfterAnswer,
  setSuggestedQuestionsAfterAnswer,
  speechToText,
  setSpeechToText,
  citation,
  setCitation,
  moderation,
  setModeration,
}: {
  introduction: string
  setIntroduction: (introduction: string) => void
  moreLikeThis: boolean
  setMoreLikeThis: (moreLikeThis: boolean) => void
  suggestedQuestionsAfterAnswer: boolean
  setSuggestedQuestionsAfterAnswer: (suggestedQuestionsAfterAnswer: boolean) => void
  speechToText: boolean
  setSpeechToText: (speechToText: boolean) => void
  citation: boolean
  setCitation: (citation: boolean) => void
  moderation: boolean
  setModeration: (moderation: boolean) => void
}) {
  const [tempshowOpeningStatement, setTempShowOpeningStatement] = React.useState(!!introduction)
  useEffect(() => {
    // wait to api data back
    if (introduction)
      setTempShowOpeningStatement(true)
  }, [introduction])

  // const [tempMoreLikeThis, setTempMoreLikeThis] = React.useState(moreLikeThis)
  // useEffect(() => {
  //   setTempMoreLikeThis(moreLikeThis)
  // }, [moreLikeThis])

  const featureConfig = {
    openingStatement: tempshowOpeningStatement,
    moreLikeThis,
    suggestedQuestionsAfterAnswer,
    speechToText,
    citation,
    moderation,
  }
  const handleFeatureChange = (key: string, value: boolean) => {
    switch (key) {
      case 'openingStatement':
        if (!value)
          setIntroduction('')

        setTempShowOpeningStatement(value)
        break
      case 'moreLikeThis':
        setMoreLikeThis(value)
        break
      case 'suggestedQuestionsAfterAnswer':
        setSuggestedQuestionsAfterAnswer(value)
        break
      case 'speechToText':
        setSpeechToText(value)
        break
      case 'citation':
        setCitation(value)
        break
      case 'moderation':
        setModeration(value)
    }
  }
  return {
    featureConfig,
    handleFeatureChange,
  }
}

export default useFeature
