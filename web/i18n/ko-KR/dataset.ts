const translation = {
  knowledge: '지식',
  documentCount: ' 문서',
  wordCount: ' k 단어',
  appCount: ' 연결된 앱',
  createDataset: '지식 생성',
  createDatasetIntro: '자체 텍스트 데이터를 가져오거나 LLM 컨텍스트를 강화하기 위해 웹훅을 통해 실시간 데이터를 기록할 수 있습니다.',
  deleteDatasetConfirmTitle: '이 지식을 삭제하시겠습니까?',
  deleteDatasetConfirmContent: '지식을 삭제하면 다시 되돌릴 수 없습니다. 사용자는 더 이상 귀하의 지식에 액세스할 수 없으며 모든 프롬프트 설정과 로그가 영구적으로 삭제됩니다.',
  datasetUsedByApp: '이 지식은 일부 앱에서 사용 중입니다. 앱에서 더 이상 이 지식을 사용할 수 없게 되며, 모든 프롬프트 구성 및 로그가 영구적으로 삭제됩니다.',
  datasetDeleted: '지식이 삭제되었습니다',
  datasetDeleteFailed: '지식 삭제에 실패했습니다',
  didYouKnow: '알고 계셨나요?',
  intro1: '지식을 Dify 애플리케이션에 ',
  intro2: '컨텍스트로',
  intro3: ' 통합할 수 있습니다.',
  intro4: '혹은, ',
  intro5: '이처럼',
  intro6: ' 독립적인 ChatGPT 인덱스 플러그인으로 공개할 수 있습니다',
  unavailable: '사용 불가',
  unavailableTip: '임베딩 모델을 사용할 수 없습니다. 기본 임베딩 모델을 설정해야 합니다.',
  datasets: '지식',
  datasetsApi: 'API',
  retrieval: {
    semantic_search: {
      title: '벡터 검색',
      description: '쿼리의 임베딩을 생성하고, 해당 벡터 표현에 가장 유사한 텍스트 청크를 검색합니다.',
    },
    full_text_search: {
      title: '전체 텍스트 검색',
      description: '문서 내 모든 용어를 인덱싱하여 사용자가 원하는 용어를 검색하고 관련 텍스트 청크를 가져올 수 있게 합니다.',
    },
    hybrid_search: {
      title: '하이브리드 검색',
      description: '전체 텍스트 검색과 벡터 검색을 동시에 실행하고 사용자 쿼리에 가장 적합한 매치를 선택하기 위해 다시 랭크를 매깁니다. 재랭크 모델 API 설정이 필요합니다.',
      recommend: '추천',
    },
    invertedIndex: {
      title: '역 인덱스',
      description: '효율적인 검색에 사용되는 구조입니다. 각 용어는 문서나 웹 페이지에 포함된 것을 가리키며, 용어마다 체계적으로 정리되어 있습니다.',
    },
    change: '변경',
    changeRetrievalMethod: '검색 방법 변경',
  },
  docsFailedNotice: '문서 인덱스에 실패했습니다',
  retry: '재시도',
}

export default translation
