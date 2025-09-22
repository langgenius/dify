const translation = {
  creation: {
    createFromScratch: {
      title: '빈 지식 파이프라인',
      description: '데이터 처리 및 구조를 완전히 제어할 수 있는 사용자 지정 파이프라인을 처음부터 만듭니다.',
    },
    caution: '주의',
    createKnowledge: '지식 창출',
    backToKnowledge: '지식으로 돌아가기',
    importDSL: 'DSL 파일에서 가져오기',
    errorTip: '기술 자료를 만들지 못했습니다.',
    successTip: '기술 자료를 성공적으로 만들었습니다.',
  },
  templates: {
    customized: '주문을 받아서 만들어진',
  },
  operations: {
    choose: '고르다',
    convert: '변환',
    preview: '미리 보기',
    process: '프로세스',
    dataSource: '데이터 소스',
    details: '세부 정보',
    saveAndProcess: '저장 및 처리',
    exportPipeline: '수출 파이프라인',
    editInfo: '정보 편집',
    backToDataSource: '데이터 소스로 돌아가기',
    useTemplate: '이 지식 파이프라인 사용',
  },
  deletePipeline: {
    title: '이 파이프라인 템플릿을 삭제하시겠습니까?',
    content: '파이프라인 템플릿을 삭제하는 것은 되돌릴 수 없습니다.',
  },
  publishPipeline: {
    success: {
      message: '지식 파이프라인 게시',
    },
    error: {
      message: '지식 파이프라인 게시 실패',
    },
  },
  publishTemplate: {
    success: {
      learnMore: '더 알아보세요',
      message: '파이프라인 템플릿 게시됨',
      tip: '생성 페이지에서 이 템플릿을 사용할 수 있습니다.',
    },
    error: {
      message: '파이프라인 템플릿을 게시하지 못했습니다.',
    },
  },
  exportDSL: {
    successTip: '파이프라인 DSL 내보내기 성공',
    errorTip: '파이프라인 DSL을 내보내지 못했습니다.',
  },
  details: {
    structure: '구조',
    structureTooltip: '청크 구조는 문서를 분할하고 인덱싱하는 방법(일반, 부모-자식 및 Q&A 모드를 제공)을 결정하며 각 기술 자료에 고유합니다.',
  },
  testRun: {
    steps: {
      documentProcessing: '문서 처리',
      dataSource: '데이터 소스',
    },
    dataSource: {
      localFiles: '로컬 파일',
    },
    notion: {
      docTitle: 'Notion 문서',
      title: 'Notion 페이지 선택',
    },
    title: '테스트 실행',
    tooltip: '테스트 실행 모드에서는 더 쉬운 디버깅 및 관찰을 위해 한 번에 하나의 문서만 가져올 수 있습니다.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: '각 입구에 대한 고유한 입력',
      tooltip: '고유 입력은 선택한 데이터 원본 및 해당 다운스트림 노드에서만 액세스할 수 있습니다. 사용자는 다른 데이터 원본을 선택할 때 입력할 필요가 없습니다. 데이터 소스 변수에서 참조하는 입력 필드만 첫 번째 단계(데이터 소스)에 표시됩니다. 다른 모든 필드는 두 번째 단계(문서 처리)에 표시됩니다.',
    },
    globalInputs: {
      title: '모든 입구에 대한 전역 입력',
      tooltip: '전역 입력은 모든 노드에서 공유됩니다. 사용자는 데이터 원본을 선택할 때 이를 입력해야 합니다. 예를 들어 구분 기호 및 최대 청크 길이와 같은 필드는 여러 데이터 원본에 균일하게 적용될 수 있습니다. 데이터 소스 변수에서 참조하는 입력 필드만 첫 번째 단계(데이터 소스)에 나타납니다. 다른 모든 필드는 두 번째 단계(문서 처리)에 표시됩니다.',
    },
    preview: {
      stepOneTitle: '데이터 소스',
      stepTwoTitle: '문서 처리',
    },
    error: {
      variableDuplicate: '변수 이름이 이미 존재합니다. 다른 이름을 선택해 주세요.',
    },
    addInputField: '입력 필드 추가',
    title: '사용자 입력 필드',
    editInputField: '입력 필드 편집',
    description: '사용자 입력 필드는 파이프라인 실행 프로세스 중에 필요한 변수를 정의하고 수집하는 데 사용됩니다. 사용자는 필드 유형을 사용자 정의하고 다양한 데이터 소스 또는 문서 처리 단계의 요구 사항을 충족하도록 입력 값을 유연하게 구성할 수 있습니다.',
  },
  addDocuments: {
    steps: {
      processingDocuments: '문서 처리',
      processDocuments: '문서 처리',
      chooseDatasource: '데이터 소스 선택',
    },
    stepOne: {
      preview: '미리 보기',
    },
    stepTwo: {
      previewChunks: '프리뷰 청크',
      chunkSettings: '청크 세팅',
    },
    stepThree: {
      learnMore: '더 알아보세요',
    },
    characters: '문자',
    backToDataSource: '데이터 소스',
    title: '문서 추가',
  },
  documentSettings: {
    title: '문서 설정',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      allFiles: '모든 파일',
      allBuckets: '모든 Cloud Storage 버킷',
      searchPlaceholder: '파일 검색...',
    },
    emptySearchResult: '항목을 찾을 수 없습니다.',
    emptyFolder: '이 폴더는 비어 있습니다.',
    resetKeywords: '키워드 재설정',
    notSupportedFileType: '이 파일 형식은 지원되지 않습니다',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: '확인',
      content: '이 작업은 영구적입니다. 이전 방법으로 되돌릴 수 없습니다. 변환을 확인하시기 바랍니다.',
    },
    title: '지식 파이프라인으로 변환',
    warning: '이 작업은 실행 취소할 수 없습니다.',
    errorMessage: '데이터 세트를 파이프라인으로 변환하지 못했습니다.',
    successMessage: '데이터 세트를 파이프라인으로 성공적으로 변환했습니다.',
    descriptionChunk2: '— 마켓플레이스의 플러그인에 액세스할 수 있는 보다 개방적이고 유연한 접근 방식입니다. 이렇게 하면 향후 모든 문서에 새로운 처리 방법이 적용됩니다.',
    descriptionChunk1: '이제 문서 처리에 지식 파이프라인을 사용하도록 기존 기술 자료를 변환할 수 있습니다',
  },
  knowledgeDescription: '지식 설명',
  knowledgePermissions: '권한을',
  inputField: '입력 필드',
  knowledgeNameAndIcon: '지식 이름 & 아이콘',
  pipelineNameAndIcon: '파이프라인 이름 & 아이콘',
  editPipelineInfo: '파이프라인 정보 편집',
  knowledgeNameAndIconPlaceholder: '기술 자료의 이름을 입력하십시오.',
  knowledgeDescriptionPlaceholder: '이 기술 자료에 포함된 내용을 설명하십시오. 자세한 설명을 통해 AI는 데이터 세트의 콘텐츠에 보다 정확하게 액세스할 수 있습니다. 비어 있으면 Dify는 기본 히트 전략을 사용합니다. (선택 사항)',
}

export default translation
