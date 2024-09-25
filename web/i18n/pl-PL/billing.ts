const translation = {
  currentPlan: 'Obecny plan',
  upgradeBtn: {
    plain: 'Ulepsz plan',
    encourage: 'Ulepsz teraz',
    encourageShort: 'Ulepsz',
  },
  viewBilling: 'Zarządzaj rozliczeniami i subskrypcjami',
  buyPermissionDeniedTip:
    'Skontaktuj się z administratorem swojej firmy, aby zasubskrybować',
  plansCommon: {
    title: 'Wybierz plan odpowiedni dla siebie',
    yearlyTip: 'Otrzymaj 2 miesiące za darmo, subskrybując rocznie!',
    mostPopular: 'Najpopularniejszy',
    planRange: {
      monthly: 'Miesięczny',
      yearly: 'Roczny',
    },
    month: 'miesiąc',
    year: 'rok',
    save: 'Oszczędź ',
    free: 'Darmowy',
    currentPlan: 'Obecny plan',
    contractSales: 'Skontaktuj się z działem sprzedaży',
    contractOwner: 'Skontaktuj się z zarządcą zespołu',
    startForFree: 'Zacznij za darmo',
    getStartedWith: 'Rozpocznij z ',
    contactSales: 'Kontakt z działem sprzedaży',
    talkToSales: 'Porozmawiaj z działem sprzedaży',
    modelProviders: 'Dostawcy modeli',
    teamMembers: 'Członkowie zespołu',
    buildApps: 'Twórz aplikacje',
    vectorSpace: 'Przestrzeń wektorowa',
    vectorSpaceBillingTooltip:
      'Każdy 1MB może przechowywać około 1,2 miliona znaków z wektoryzowanych danych (szacowane na podstawie OpenAI Embeddings, różni się w zależności od modelu).',
    vectorSpaceTooltip:
      'Przestrzeń wektorowa jest systemem pamięci długoterminowej wymaganym dla LLM, aby zrozumieć Twoje dane.',
    documentsUploadQuota: 'Limit przesyłanych dokumentów',
    documentProcessingPriority: 'Priorytet przetwarzania dokumentów',
    documentProcessingPriorityTip:
      'Dla wyższego priorytetu przetwarzania dokumentów, ulepsz swój plan.',
    documentProcessingPriorityUpgrade:
      'Przetwarzaj więcej danych z większą dokładnością i w szybszym tempie.',
    priority: {
      'standard': 'Standardowy',
      'priority': 'Priorytetowy',
      'top-priority': 'Najwyższy priorytet',
    },
    logsHistory: 'Historia logów',
    customTools: 'Niestandardowe narzędzia',
    unavailable: 'Niedostępne',
    days: 'dni',
    unlimited: 'Nieograniczony',
    support: 'Wsparcie',
    supportItems: {
      communityForums: 'Forum społecznościowe',
      emailSupport: 'Wsparcie mailowe',
      priorityEmail: 'Priorytetowa pomoc mailowa i czat',
      logoChange: 'Zmiana logo',
      SSOAuthentication: 'Uwierzytelnianie SSO',
      personalizedSupport: 'Personalizowane wsparcie',
      dedicatedAPISupport: 'Dedykowane wsparcie API',
      customIntegration: 'Niestandardowa integracja i wsparcie',
      ragAPIRequest: 'Żądania API RAG',
      bulkUpload: 'Masowe przesyłanie dokumentów',
      agentMode: 'Tryb agenta',
      workflow: 'Przepływ pracy',
      llmLoadingBalancing: 'Równoważenie obciążenia LLM',
      llmLoadingBalancingTooltip: 'Dodaj wiele kluczy API do modeli, skutecznie omijając limity szybkości interfejsu API.',
    },
    comingSoon: 'Wkrótce dostępne',
    member: 'Członek',
    memberAfter: 'Członek',
    messageRequest: {
      title: 'Limity kredytów wiadomości',
      tooltip:
        'Limity wywołań wiadomości dla różnych planów używających modeli OpenAI (z wyjątkiem gpt4). Wiadomości przekraczające limit będą korzystać z twojego klucza API OpenAI.',
    },
    annotatedResponse: {
      title: 'Limity kredytów na adnotacje',
      tooltip:
        'Ręczna edycja i adnotacja odpowiedzi zapewniają możliwość dostosowania wysokiej jakości odpowiedzi na pytania dla aplikacji. (Stosowane tylko w aplikacjach czatowych)',
    },
    ragAPIRequestTooltip:
      'Odnosi się do liczby wywołań API wykorzystujących tylko zdolności przetwarzania bazy wiedzy Dify.',
    receiptInfo:
      'Tylko właściciel zespołu i administrator zespołu mogą subskrybować i przeglądać informacje o rozliczeniach',
    annotationQuota: 'Przydział adnotacji',
  },
  plans: {
    sandbox: {
      name: 'Sandbox',
      description: '200 razy darmowa próba GPT',
      includesTitle: 'Zawiera:',
    },
    professional: {
      name: 'Profesjonalny',
      description:
        'Dla osób fizycznych i małych zespołów, aby odblokować więcej mocy w przystępnej cenie.',
      includesTitle: 'Wszystko w darmowym planie, plus:',
    },
    team: {
      name: 'Zespół',
      description:
        'Współpracuj bez ograniczeń i ciesz się najwyższą wydajnością.',
      includesTitle: 'Wszystko w planie Profesjonalnym, plus:',
    },
    enterprise: {
      name: 'Przedsiębiorstwo',
      description:
        'Uzyskaj pełne możliwości i wsparcie dla systemów o kluczowym znaczeniu dla misji.',
      includesTitle: 'Wszystko w planie Zespołowym, plus:',
    },
  },
  vectorSpace: {
    fullTip: 'Przestrzeń wektorowa jest pełna.',
    fullSolution: 'Ulepsz swój plan, aby uzyskać więcej miejsca.',
  },
  apps: {
    fullTipLine1: 'Ulepsz swój plan, aby',
    fullTipLine2: 'tworzyć więcej aplikacji.',
  },
  annotatedResponse: {
    fullTipLine1: 'Ulepsz swój plan, aby',
    fullTipLine2: 'adnotować więcej rozmów.',
    quotaTitle: 'Limit adnotacji odpowiedzi',
  },
}

export default translation
