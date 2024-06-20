const translation = {
  title: '지식 설정',
  desc: '여기에서 지식의 속성과 작동 방법을 변경할 수 있습니다.',
  form: {
    name: '지식 이름',
    namePlaceholder: '지식 이름을 입력하세요',
    nameError: '이름은 비워둘 수 없습니다',
    desc: '지식 설명',
    descInfo: '지식 내용을 개괄하는 명확한 텍스트 설명을 작성하세요. 이 설명은 여러 지식 중에서 선택하는 기준으로 사용됩니다.',
    descPlaceholder: '이 지식에 포함된 내용을 설명하세요. 자세한 설명은 AI가 지식 내용에 빠르게 접근할 수 있도록 합니다. 비어 있으면 Dify가 기본 검색 전략을 사용합니다.',
    descWrite: '좋은 지식 설명 작성 방법 배우기',
    permissions: '권한',
    permissionsOnlyMe: '나만',
    permissionsAllMember: '모든 팀 멤버',
    indexMethod: '인덱스 방법',
    indexMethodHighQuality: '고품질',
    indexMethodHighQualityTip: '사용자 쿼리 시 더 높은 정확도를 제공하기 위해 Embedding 모델을 호출하여 처리합니다.',
    indexMethodEconomy: '경제적',
    indexMethodEconomyTip: '오프라인 벡터 엔진, 키워드 인덱스 등을 사용하여 토큰을 소비하지 않고도 정확도를 감소시킵니다.',
    embeddingModel: '임베딩 모델',
    embeddingModelTip: '임베딩 모델 변경은',
    embeddingModelTipLink: '설정',
    retrievalSetting: {
      title: '검색 설정',
      learnMore: '자세히 알아보기',
      description: ' 검색 방법에 대한 자세한 정보',
      longDescription: ' 검색 방법에 대한 자세한 내용은 언제든지 지식 설정에서 변경할 수 있습니다.',
    },
    save: '저장',
  },
}

export default translation
