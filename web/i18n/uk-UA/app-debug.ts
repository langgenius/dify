const translation = {
  pageTitle: {
    line1: 'PROMPT',
    line2: 'Engineering', // Or 'інженерія'
  },
  orchestrate: 'Диригувати',
  promptMode: {
    simple: 'Перейти в експертний режим, щоб редагувати весь запрос PROMPT',
    advanced: 'Експертний режим',
    switchBack: 'Змінити налаштування',
    advancedWarning: {
      title: 'Ви перейшли в експертний режим, і після того, як ви зміните PROMPT, ви НЕ можете повернутися назад в базовий режим.',
      description: 'В експертному режимі ви можете редагувати весь PROMPT.',
      learnMore: 'Детальніше',
      ok: 'Гаразд',
    },
    operation: {
      addMessage: 'Додати повідомлення',
    },
    contextMissing: 'Компонент контексту відсутній, ефективність підказки може бути не найкращою.',
  },
  operation: {
    applyConfig: 'Опублікувати',
    resetConfig: 'Скинути',
    debugConfig: 'Налагодження',
    addFeature: 'Додати функціонал',
    automatic: 'Автоматично',
    stopResponding: 'Припинити реагувати',
    agree: 'лайк',
    disagree: 'дизлайк',
    cancelAgree: 'Скасувати лайк',
    cancelDisagree: 'Скасувати дизлайк',
    userAction: 'Користувач ',
  },
  notSetAPIKey: {
    title: 'Ключ провайдера LLM не встановлено',
    trailFinished: 'Демо закінчилось',
    description: 'Ключ провайдера LLM не встановлено, і його потрібно встановити перед налагодженням.',
    settingBtn: 'Перейти до налаштувань',
  },
  trailUseGPT4Info: {
    title: 'Поки не підтримує gpt-4',
    description: 'Щоб використовувати gpt-4, будь ласка, встановіть ключ API.',
  },
  feature: {
    groupChat: {
      title: 'Вдосконалення чату',
      description: 'Додайте налаштування попередньої розмови для додатків, щоб покращити користувацький досвід.',
    },
    groupExperience: {
      title: 'Покращення досвіду',
    },
    conversationOpener: {
      title: 'Ініціатори розмови',
      description: 'У чат-додатках перше речення, яке ШІ активно промовляє користувачеві, зазвичай використовується як привітання.',
    },
    suggestedQuestionsAfterAnswer: {
      title: 'Наступні',
      description: 'Налаштування пропозицій наступних запитань може надати користувачам кращий чат.',
      resDes: '3 пропозиції для наступного питання користувача.',
      tryToAsk: 'Спробуйте спитати',
    },
    moreLikeThis: {
      title: 'Більше такого',
      description: 'Згенерувати кілька текстів одночасно, а потім редагувати та продовжити генерацію',
      generateNumTip: 'Кількість кожної генерації ',
      tip: 'Використання цієї функції призведе до додаткових витрат токенів',
    },
    speechToText: {
      title: 'Мовлення в текст',
      description: 'Після увімкнення ви можете використовувати голосовий ввід.',
      resDes: 'Голосовий ввід увімкнено',
    },
    textToSpeech: {
      title: 'Текст у мовлення',
      description: 'Після увімкнення текст може бути перетворений у мовлення.',
      resDes: 'Перетворення тексту на аудіо включено',
    },
    citation: {
      title: 'Цитати та Атрибуції', // Citations and Attributions
      description: 'Після активації показувати вихідний документ та атрибутований розділ згенерованого вмісту.',
      resDes: 'Цитати та Атрибуції активовано',
    },
    annotation: {
      title: 'Відповідь-Анотація', // Annotation Reply
      description: 'Ви можете вручну додати високоякісну відповідь до кешу для пріоритетного порівняння з подібними запитаннями користувачів.',
      resDes: 'Відповідь-Анотація увімкнена',
      scoreThreshold: {
        title: 'Поріг оцінки', // Score Threshold
        description: 'Використовується для встановлення порогу схожості для відповіді-анотації.',
        easyMatch: 'Легке співпадіння', // Easy Match
        accurateMatch: 'Точне співпадіння', // Accurate Match
      },
      matchVariable: {
        title: 'Збіг змінних', // Match Variable
        choosePlaceholder: 'Виберіть змінну відповідності', // Choose match variable
      },
      cacheManagement: 'Анотації', // Annotations
      cached: 'Анотовано', // Annotated
      remove: 'Видалити', // Remove
      removeConfirm: 'Видалити цю анотацію?',
      add: 'Додати анотацію', // Add annotation
      edit: 'Редагувати анотацію', // Edit annotation
    },
    dataSet: {
      title: 'Контекст', // Context
      noData: 'Ви можете імпортувати знання як контекст', // You can import Knowledge as context
      words: 'Слова', // Words
      textBlocks: 'Текстові блоки', // Text Blocks
      selectTitle: 'Виберіть довідкові знання', // Select reference Knowledge
      selected: 'Знання обрані', // Knowledge selected
      noDataSet: 'Знання не знайдені', // No Knowledge found
      toCreate: 'Перейти до створення', // Go to create
      notSupportSelectMulti: 'Наразі підтримується лише одне знання', // Currently only support one Knowledge
      queryVariable: {
        title: 'Змінна запиту', // Query variable
        tip: 'Ця змінна буде використовуватися як вхідний запит для отримання контексту, отримання контекстної інформації, пов’язаної з введенням цієї змінної.',
        choosePlaceholder: 'Виберіть змінну для запиту', // Choose query variable
        noVar: 'Змінних немає', // No variables
        noVarTip: 'будь ласка, створіть змінну в розділі Змінні', // please create a variable under the Variables section
        unableToQueryDataSet: 'Неможливо виконати запит до Знань', // Unable to query the Knowledge
        unableToQueryDataSetTip: 'Не вдалося успішно виконати запит до Бази Знань, будь ласка, виберіть змінну контекстного запиту в розділі контексту.',
        ok: 'ОК', // OK
        contextVarNotEmpty: 'змінна контекстного запиту не може бути порожньою', // context query variable can not be empty
        deleteContextVarTitle: 'Видалити змінну “{{varName}}”?', // Delete variable “{{varName}}”?
        deleteContextVarTip: 'Ця змінна була встановлена ​​як змінна контекстного запиту, і її видалення вплине на нормальне використання Знань. Якщо вам все ще потрібно її видалити, будь ласка, виберіть її повторно в розділі контексту.',
      },
    },
    tools: {
      title: 'Інструменти', // Tools
      tips: 'Інструменти надають стандартний метод виклику API, приймаючи вхідні дані користувача або змінні як параметри запиту для запиту зовнішніх даних як контексту.',
      toolsInUse: 'Використовується інструментів: {{count}}', // {{count}} tools in use
      modal: {
        title: 'Інструмент', // Tool
        toolType: {
          title: 'Тип інструменту', // Tool Type
          placeholder: 'Будь ласка, виберіть тип інструменту', // Please select the tool type
        },
        name: {
          title: 'Назва', // Name
          placeholder: 'Будь ласка, введіть назву', // Please enter the name
        },
        variableName: {
          title: 'Назва змінної', // Variable Name
          placeholder: 'Будь ласка, введіть назву змінної', // Please enter the variable name
        },
      },
    },
    conversationHistory: {
      title: 'Історія розмов', // Conversation History
      description: 'Встановіть префікси для ролей у розмові', // Set prefix names for conversation roles
      tip: 'Історію розмов не ввімкнено, додайте <histories> у запит вище.', // The Conversation History is not enabled, please add <histories> in the prompt above.
      learnMore: 'Дізнатися більше', // Learn more
      editModal: {
        title: 'Редагувати назви ролей у розмові', // Edit Conversation Role Names
        userPrefix: 'Префікс користувача', // User prefix
        assistantPrefix: 'Префікс помічника', // Assistant prefix
      },
    },
    toolbox: {
      title: 'ІНСТРУМЕНТИ', // TOOLBOX (all caps to convey its section title nature)
    },
    moderation: {
      title: 'Модерація контенту', // Content moderation
      description: 'Захистіть вивід моделі, використовуючи API модерації або список конфіденційних слів.', // Secure model output...
      allEnabled: 'Вміст ВВЕДЕННЯ/ВИВЕДЕННЯ ввімкнено', // INPUT/OUTPUT Content Enabled
      inputEnabled: 'Вміст ВВЕДЕННЯ ввімкнено', // INPUT Content Enabled
      outputEnabled: 'Вміст ВИВЕДЕННЯ ввімкнено', // OUTPUT Content Enabled
      modal: {
        title: 'Налаштування модерації вмісту', // Content moderation settings
        provider: {
          title: 'Провайдер', // Provider
          openai: 'Модерація OpenAI', // OpenAI Moderation
          openaiTip: {
            prefix: 'Для модерації OpenAI потрібен ключ API OpenAI, налаштований у ',
            suffix: '.',
          },
          keywords: 'Ключові слова', // Keywords
        },
        keywords: {
          tip: 'По одному на рядок, розділені розривами рядків. До 100 символів у рядку.',
          placeholder: 'По одному на рядок, розділені розривами рядків',
          line: 'Рядок',
        },
        content: {
          input: 'Помірне ВВЕДЕННЯ Вмісту',
          output: 'Помірне ВИВЕДЕННЯ Вмісту',
          preset: 'Попередньо встановлені відповіді', // Preset replies
          placeholder: 'Попередньо встановлені відповіді тут',
          condition: 'Увімкнено принаймні одне: «Модерувати ВВЕДЕННЯ ТА ВИВЕДЕННЯ Вмісту»',
          fromApi: 'Попередньо встановлені відповіді повертаються через API', // Preset replies are returned by API
          errorMessage: 'Попередньо встановлені відповіді не можуть бути порожніми',
          supportMarkdown: 'Підтримка Markdown', // Markdown supported
        },
        openaiNotConfig: {
          before: 'Модерація OpenAI вимагає, щоб ключ API OpenAI був налаштований у ',
          after: '',
        },
      },
    },
  },
  automatic: {
    title: 'Автоматизована оркестрація застосунків',
    description: 'Опишіть свій сценарій, Dify збере для вас застосунок.',
    intendedAudience: 'Хто є цільовою аудиторією?',
    intendedAudiencePlaceHolder: 'напр. Студент',
    solveProblem: 'Які проблеми вони сподіваються вирішити за допомогою AI?',
    solveProblemPlaceHolder: 'напр. Оцінка успішності',
    generate: 'Генерувати',
    audiencesRequired: 'Необхідна аудиторія',
    problemRequired: 'Необхідна проблема',
    resTitle: 'Ми створили для вас такий застосунок.',
    apply: 'Застосувати цю оркестрацію',
    noData: 'Опишіть свій випадок використання зліва, тут буде показано попередній перегляд оркестрації.',
    loading: 'Оркестрація програми для вас...',
    overwriteTitle: 'Перезаписати існуючу конфігурацію?',
    overwriteMessage: 'Застосування цієї оркестрації призведе до перезапису існуючої конфігурації.',
  },
  resetConfig: {
    title: 'Підтвердіть скидання?',
    message: 'Скидання призводить до скасування змін, відновлюючи останню опубліковану конфігурацію.',
  },
  errorMessage: {
    nameOfKeyRequired: 'назва ключа: {{key}} обов’язкова', // name of the key: {{key}} required
    valueOfVarRequired: 'значення {{key}} не може бути порожнім', // {{key}} value can not be empty
    queryRequired: 'Текст запиту обов’язковий.', // Request text is required.
    waitForResponse: 'Будь ласка, зачекайте, доки буде завершено відповідь на попереднє повідомлення.', // Please wait for the response to the previous message to complete.
    waitForBatchResponse: 'Будь ласка, дочекайтеся завершення відповіді на пакетне завдання.', // Please wait for the response to the batch task to complete.
    notSelectModel: 'Будь ласка, виберіть модель', // Please choose a model
    waitForImgUpload: 'Будь ласка, зачекайте, поки зображення завантажиться', // Please wait for the image to upload
  },
  chatSubTitle: 'Інструкції', // Instructions
  completionSubTitle: 'Префікс команди', // Prefix Prompt
  promptTip: 'Запити керують відповідями ШІ, надаючи інструкції та обмеження. Вставте змінні, як-от {{input}}. Цей запит не буде видно користувачам.',
  formattingChangedTitle: 'Змінено форматування', // Formatting changed
  formattingChangedText: 'Змінення форматування призведе до скидання області налагодження. Ви впевнені?', // Modifying the formatting will reset the debug area, are you sure?
  variableTitle: 'Змінні', // Variables
  variableTip: 'Користувачі заповнюють змінні у формі, автоматично замінюючи змінні в команді.',
  notSetVar: 'Змінні дозволяють користувачам вводити підказки або вступні зауваження під час заповнення форм. Ви можете спробувати ввести "{{input}}" у слова підказки.',
  autoAddVar: 'На невизначені змінні, на які посилаються в попередньому запиті, є посилання. Ви хочете додати їх у форму вводу користувача?', // Undefined variables referenced in pre-prompt, are you want to add them in user input form?
  variableTable: {
    key: 'Ключ змінної', // Variable Key
    name: 'Назва поля для введення користувача', // User Input Field Name
    optional: 'Додатково', // Optional
    type: 'Тип введення', // Input Type
    action: 'Дії', // Actions
    typeString: 'Рядок', // String
    typeSelect: 'Вибрати', // Select
  },
  varKeyError: {
    canNoBeEmpty: 'Ключ змінної не може бути порожнім', // Variable key can not be empty
    tooLong: 'Ключ змінної: {{key}} занадто довгий. Не може бути більше 30 символів', // Variable key: {{key}} too length. Can not be longer then 30 characters
    notValid: 'Ключ змінної: {{key}} недійсний. Може містити лише літери, цифри та підкреслення', // Variable key: {{key}} is invalid. Can only contain letters, numbers, and underscores
    notStartWithNumber: 'Ключ змінної: {{key}} не може починатися з цифри', // Variable key: {{key}} can not start with a number
    keyAlreadyExists: 'Ключ змінної: :{{key}} вже існує', // Variable key: :{{key}} already exists
  },
  otherError: {
    promptNoBeEmpty: 'Команда не може бути порожньою', // Prompt can not be empty
    historyNoBeEmpty: 'Історію розмови необхідно встановити у підказці', // Conversation history must be set in the prompt
    queryNoBeEmpty: 'Запит має бути встановлений у підказці', // Query must be set in the prompt
  },
  variableConig: {
    'addModalTitle': 'Додати Поле Введення',
    'editModalTitle': 'Редагувати Поле Введення',
    'description': 'Налаштування для змінної {{varName}}',
    'fieldType': 'Тип поля',
    'string': 'Короткий текст',
    'text-input': 'Короткий текст',
    'paragraph': 'Параграф',
    'select': 'Вибрати',
    'number': 'Число',
    'notSet': 'Не встановлено, спробуйте ввести {{input}} у префіксній підказці',
    'stringTitle': 'Параметри поля введення форми',
    'maxLength': 'Максимальна довжина',
    'options': 'Опції',
    'addOption': 'Додати опцію',
    'apiBasedVar': 'Змінна на основі API',
    'varName': 'Назва змінної',
    'labelName': 'Назва мітки',
    'inputPlaceholder': 'Будь ласка, введіть',
    'required': 'Обов\'язково',
    'errorMsg': {
      varNameRequired: 'Потрібно вказати назву змінної',
      labelNameRequired: 'Потрібно вказати назву мітки',
      varNameCanBeRepeat: 'Назва змінної не може повторюватися',
      atLeastOneOption: 'Потрібно щонайменше одну опцію',
      optionRepeat: 'Є повторні опції',
    },
  },
  vision: {
    name: 'Зображення', // Vision
    description: 'Увімкнення функції "Зображення" дозволить моделі приймати зображення та відповідати на запитання про них.',
    settings: 'Налаштування', // Settings
    visionSettings: {
      title: 'Налаштування зображень', // Vision Settings
      resolution: 'Роздільна здатність', // Resolution
      resolutionTooltip: `низька роздільна здатність дозволить моделі отримати зображення з низькою роздільною здатністю 512 x 512 пікселів і представити зображення з обмеженням у 65 токенів. Це дозволяє API швидше повертати відповіді та споживати менше вхідних токенів для випадків використання, які не потребують високої деталізації.
    \n
    висока роздільна здатність спочатку дозволить моделі побачити зображення з низькою роздільною здатністю, а потім створити детальні фрагменти вхідних зображень у вигляді квадратів 512px на основі розміру вхідного зображення. Кожен із детальних фрагментів використовує подвійний запас токенів, загалом 129 токенів.`,
      high: 'Висока', // High
      low: 'Низька', // Low
      uploadMethod: 'Спосіб завантаження', // Upload Method
      both: 'Обидва', // Both
      localUpload: 'Локальне завантаження', // Local Upload
      url: 'URL-адреса', // URL
      uploadLimit: 'Ліміт завантаження', // Upload Limit
    },
  },
  voice: {
    name: 'Голос', // Voice
    defaultDisplay: 'Голос за замовчуванням', // Default Voice
    description: 'Налаштування синтезу мовлення', //  Text to speech voice Settings
    settings: 'Налаштування', // Settings
    voiceSettings: {
      title: 'Налаштування голосу', // Voice Settings
      language: 'Мова', // Language
      resolutionTooltip: 'Мовна підтримка для синтезу мовлення.', // Text-to-speech voice support language。
      voice: 'Голос', // Voice
    },
  },
  openingStatement: {
    title: 'Вступ до розмови', // Conversation Opener
    add: 'Додати', // Add
    writeOpner: 'Напишіть вступне повідомлення', // Write opener
    placeholder: 'Напишіть тут своє вступне повідомлення, ви можете використовувати змінні, спробуйте ввести {{variable}}.', // Write your opener message here...
    openingQuestion: 'Відкриваючі питання', // Opening Questions
    noDataPlaceHolder: 'Початок розмови з користувачем може допомогти ШІ встановити більш тісний зв’язок з ним у розмовних застосунках.', // ... conversational applications.
    varTip: 'Ви можете використовувати змінні, спробуйте ввести {{variable}}', // You can use variables, try type {{variable}}
    tooShort: 'Для створення вступних зауважень для розмови потрібно принаймні 20 слів вступного запиту.', // ... are required to generate an opening remarks for the conversation.
    notIncludeKey: 'Початковий запит не включає змінну: {{key}}. Будь ласка, додайте її до початкового запиту.', // ... does not include the variable ...
  },
  modelConfig: {
    model: 'Модель', // Model
    setTone: 'Встановити тон відповідей', // Set tone of responses
    title: 'Модель і параметри', // Model and Parameters
    modeType: {
      chat: 'Чат', // Chat
      completion: 'Завершення', // Complete
    },
  },
  inputs: {
    title: 'Налагодження та попередній перегляд', // Debug and Preview
    noPrompt: 'Спробуйте написати якийсь запит у полі введення префіксу команди', // Try write some prompt in pre-prompt input
    userInputField: 'Поле введення користувача', // User Input Field
    noVar: 'Заповніть значення змінної, яка буде автоматично замінена в слові-підказці під час кожного запуску нового сеансу.', // Fill in the value of the variable...
    chatVarTip: 'Заповніть значення змінної, яка буде автоматично замінена в слові-підказці під час кожного запуску нового сеансу.', // Fill in the value of the variable...
    completionVarTip: 'Заповніть значення змінної, яка буде автоматично замінена в словах-підказках під час кожного відправлення запиту.', // Fill in the value of the variable...
    previewTitle: 'Попередній перегляд підказки', // Prompt preview
    queryTitle: 'Вміст запиту', // Query content
    queryPlaceholder: 'Будь ласка, введіть текст запиту', // Please enter the request text.
    run: 'ЗАПУСТИТИ', // RUN
  },
  result: 'Вихідний текст', // Output Text
  datasetConfig: {
    settingTitle: 'Налаштування пошуку', // Retrieval settings
    knowledgeTip: 'Клацніть кнопку “+”, щоб додати знання',
    retrieveOneWay: {
      title: 'Односторонній пошук', // N-to-1 retrieval
      description: 'На основі намірів користувача та описів Знань Агент самостійно вибирає найкращі Знання для запитів. Найкраще підходить для застосунків з окремими, обмеженими Знаннями.',
    },
    retrieveMultiWay: {
      title: 'Багатосторонній пошук', // Multi-path retrieval
      description: 'На основі намірів користувача запитує по всіх Базах Знань, отримує релевантний текст із кількох джерел і вибирає найкращі результати, що відповідають запиту користувача, після переранжування. Необхідна конфігурація API моделі переранжування.',
    },
    rerankModelRequired: 'Необхідна модель переранжування', // Rerank model is required
    params: 'Параметри', // Params
    top_k: 'Найкращих K', // Top K
    top_kTip: 'Використовується для фільтрації фрагментів, найбільш схожих на запитання користувачів. Система також динамічно регулюватиме значення K у відповідності з max_tokens обраної моделі.',
    score_threshold: 'Поріг оцінки', // Score Threshold
    score_thresholdTip: 'Використовується для встановлення порогу схожості для фільтрації фрагментів.',
    retrieveChangeTip: 'Зміна  режиму індексування та режиму отримання може вплинути на застосунки, пов’язані з цими знаннями.', // Modifying...
  },
  debugAsSingleModel: 'Налагодження як одна модель', // Debug as Single Model
  debugAsMultipleModel: 'Налагодження як багато моделей', // Debug as Multiple Models
  duplicateModel: 'Дублювання', // Duplicate
  publishAs: 'Опублікувати як', // Publish as
  assistantType: {
    name: 'Тип Асистента', // Assistant Type
    chatAssistant: {
      name: 'Базовий помічник', // Basic Assistant
      description: 'Створіть помічника на базі чату за допомогою великої мовної моделі', // Build a chat-based...
    },
    agentAssistant: {
      name: 'Інтелектуальний помічник', // Agent Assistant
      description: 'Створіть інтелектуального агента, який може самостійно вибирати інструменти для виконання завдань', // Build an intelligent Agent...
    },
  },
  agent: {
    agentMode: 'Режим агента', // Agent Mode
    agentModeDes: 'Встановіть тип режиму висновку для агента', // Set the type of inference mode...
    agentModeType: {
      ReACT: 'ReACT',
      functionCall: 'Виклик функції', // Function Calling
    },
    setting: {
      name: 'Налаштування агента', // Agent Settings
      description: 'Налаштування агента дозволяють встановити режим агента та розширені функції, наприклад вбудовані команди, доступні тільки для типу агента.', // Agent Assistant settings allow...
      maximumIterations: {
        name: 'Максимальна кількість ітерацій', // Maximum Iterations
        description: 'Обмежте кількість ітерацій, які може виконати помічник агента', // Limit the number of iterations...
      },
    },
    buildInPrompt: 'Вбудована команда', // Build-In Prompt
    firstPrompt: 'Перша команда', // First Prompt
    nextIteration: 'Наступна ітерація', // Next Iteration
    promptPlaceholder: 'Напишіть тут своє запрошення', // Write your prompt here
    tools: {
      name: 'Інструменти', // Tools
      description: 'Використання інструментів може розширити можливості LLM, наприклад, пошук в Інтернеті або виконання наукових розрахунків', // Using tools can extend...
      enabled: 'Увімкнено', // Enabled
    },
  },
}

export default translation
