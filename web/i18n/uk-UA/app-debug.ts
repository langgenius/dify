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
      // Content moderation
      title: 'Модерація контенту',
      // Secure model output...
      description: 'Захистіть вивід моделі, використовуючи API модерації або список конфіденційних слів.',
      // INPUT/OUTPUT Content Enabled
      allEnabled: 'Вміст ВВЕДЕННЯ/ВИВЕДЕННЯ ввімкнено',
      // INPUT Content Enabled
      inputEnabled: 'Вміст ВВЕДЕННЯ ввімкнено',
      // OUTPUT Content Enabled
      outputEnabled: 'Вміст ВИВЕДЕННЯ ввімкнено',
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
      contentEnableLabel: 'Модерація контенту увімкнена',
    },
    fileUpload: {
      title: 'Завантаження файлу',
      description: 'Поле вводу чату дозволяє завантажувати зображення, документи та інші файли.',
      supportedTypes: 'Підтримувані типи файлів',
      numberLimit: 'Максимальна кількість завантажень',
      modalTitle: 'Налаштування завантаження файлів',
    },
    imageUpload: {
      title: 'Завантаження зображення',
      description: 'Дозволити завантаження зображень.',
      supportedTypes: 'Підтримувані типи файлів',
      numberLimit: 'Максимальна кількість завантажень',
      modalTitle: 'Налаштування завантаження зображень',
    },
    bar: {
      empty: 'Увімкніть функції для покращення користувацького досвіду веб-додатка',
      enableText: 'Функції увімкнено',
      manage: 'Керувати',
    },
    documentUpload: {
      title: 'Документ',
      description: 'Увімкнення документа дозволить моделі приймати документи та відповідати на запитання про них.',
    },
    audioUpload: {
      title: 'Аудіо',
      description: 'Увімкнення аудіо дозволить моделі обробляти аудіофайли для транскрипції та аналізу.',
    },
  },
  automatic: {
  },
  resetConfig: {
    title: 'Підтвердіть скидання?',
    message: 'Скидання призводить до скасування змін, відновлюючи останню опубліковану конфігурацію.',
  },
  errorMessage: {
    // name of the key: {{key}} required
    nameOfKeyRequired: 'назва ключа: {{key}} обов’язкова',
    // {{key}} value can not be empty
    valueOfVarRequired: 'значення {{key}} не може бути порожнім',
    // Request text is required.
    queryRequired: 'Текст запиту обов’язковий.',
    // Please wait for the response to the previous message to complete.
    waitForResponse: 'Будь ласка, зачекайте, доки буде завершено відповідь на попереднє повідомлення.',
    // Please wait for the response to the batch task to complete.
    waitForBatchResponse: 'Будь ласка, дочекайтеся завершення відповіді на пакетне завдання.',
    // Please choose a model
    notSelectModel: 'Будь ласка, виберіть модель',
    // Please wait for the image to upload
    waitForImgUpload: 'Будь ласка, зачекайте, поки зображення завантажиться',
    waitForFileUpload: 'Будь ласка, зачекайте, поки файл/файли завантажаться',
  },
  // Instructions
  chatSubTitle: 'Інструкції',
  // Prefix Prompt
  completionSubTitle: 'Префікс команди',
  promptTip: 'Запити керують відповідями ШІ, надаючи інструкції та обмеження. Вставте змінні, як-от {{input}}. Цей запит не буде видно користувачам.',
  // Formatting changed
  formattingChangedTitle: 'Змінено форматування',
  // Modifying the formatting will reset the debug area, are you sure?
  formattingChangedText: 'Змінення форматування призведе до скидання області налагодження. Ви впевнені?',
  // Variables
  variableTitle: 'Змінні',
  variableTip: 'Користувачі заповнюють змінні у формі, автоматично замінюючи змінні в команді.',
  notSetVar: 'Змінні дозволяють користувачам вводити підказки або вступні зауваження під час заповнення форм. Ви можете спробувати ввести "{{input}}" у слова підказки.',
  // Undefined variables referenced in pre-prompt, are you want to add them in user input form?
  autoAddVar: 'На невизначені змінні, на які посилаються в попередньому запиті, є посилання. Ви хочете додати їх у форму вводу користувача?',
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
    canNoBeEmpty: 'Потрібен {{key}}', // Variable key can not be empty
    tooLong: '{{key}} занадто довгий. Не може бути більше 30 символів', // Variable key: {{key}} too length. Can not be longer then 30 characters
    notValid: '{{key}} недійсний. Може містити лише літери, цифри та підкреслення', // Variable key: {{key}} is invalid. Can only contain letters, numbers, and underscores
    notStartWithNumber: '{{key}} не може починатися з цифри', // Variable key: {{key}} can not start with a number
    keyAlreadyExists: ':{{key}} вже існує', // Variable key: :{{key}} already exists
  },
  otherError: {
    promptNoBeEmpty: 'Команда не може бути порожньою', // Prompt can not be empty
    historyNoBeEmpty: 'Історію розмови необхідно встановити у підказці', // Conversation history must be set in the prompt
    queryNoBeEmpty: 'Запит має бути встановлений у підказці', // Query must be set in the prompt
  },
  variableConfig: {
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
    'hide': 'Приховати',
    'errorMsg': {
      labelNameRequired: 'Потрібно вказати назву мітки',
      varNameCanBeRepeat: 'Назва змінної не може повторюватися',
      atLeastOneOption: 'Потрібно щонайменше одну опцію',
      optionRepeat: 'Є повторні опції',
    },
    'defaultValue': 'Значення за замовчуванням',
    'noDefaultValue': 'Без значення за замовчуванням',
    'selectDefaultValue': 'Обрати значення за замовчуванням',
    'file': {
      image: {
        name: 'Образ',
      },
      audio: {
        name: 'Аудіо',
      },
      document: {
        name: 'Документ',
      },
      video: {
        name: 'Відео',
      },
      custom: {
        description: 'Укажіть інші типи файлів.',
        createPlaceholder: '  Розширення файлу, наприклад .doc',
        name: 'Інші типи файлів',
      },
      supportFileTypes: 'Підтримка типів файлів',
    },
    'content': 'Вміст',
    'both': 'Як',
    'single-file': 'Один файл',
    'multi-files': 'Список файлів',
    'localUpload': 'Локальне завантаження',
    'uploadFileTypes': 'Типи файлів для завантаження',
    'maxNumberOfUploads': 'Максимальна кількість завантажень',
    'jsonSchema': 'JSON схема',
    'optional': 'додатковий',
    'json': 'JSON Код',
    'checkbox': 'Чекбокс',
    'unit': 'Одиниці',
    'placeholder': 'Заповнювач',
    'noDefaultSelected': 'Не вибирати',
    'startChecked': 'Почати перевірено',
    'displayName': 'Відображуване ім\'я',
    'uploadMethod': 'Спосіб завантаження',
    'showAllSettings': 'Показати всі налаштування',
    'startSelectedOption': 'Почати вибраний варіант',
    'tooltips': 'Спливаючі чтива',
    'placeholderPlaceholder': 'Введіть текст для відображення, коли поле порожнє',
    'unitPlaceholder': 'Показувати одиниці виміру після чисел, наприклад токени',
    'defaultValuePlaceholder': 'Введіть значення за замовчуванням, щоб попередньо заповнити поле',
    'tooltipsPlaceholder': 'Введіть корисний текст, який відображається при наведенні курсору на мітку',
  },
  vision: {
    // Vision
    name: 'Зображення',
    description: 'Увімкнення функції "Зображення" дозволить моделі приймати зображення та відповідати на запитання про них.',
    // Settings
    settings: 'Налаштування',
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
    onlySupportVisionModelTip: 'Підтримує лише моделі зору',
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
      autoPlay: 'Автоматичне відтворення',
      autoPlayEnabled: 'ВІДЧИНЕНО',
      autoPlayDisabled: 'закриття',
    },
  },
  openingStatement: {
    title: 'Вступ до розмови', // Conversation Opener
    add: 'Додати', // Add
    writeOpener: 'Напишіть вступне повідомлення', // Write opener
    placeholder: 'Напишіть тут своє вступне повідомлення, ви можете використовувати змінні, спробуйте ввести {{variable}}.', // Write your opener message here...
    openingQuestion: 'Відкриваючі питання', // Opening Questions
    openingQuestionPlaceholder: 'Ви можете використовувати змінні, спробуйте ввести {{variable}}.',
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
  // Output Text
  result: 'Вихідний текст',
  datasetConfig: {
    // Retrieval settings
    settingTitle: 'Налаштування пошуку',
    knowledgeTip: 'Клацніть кнопку “+”, щоб додати знання',
    retrieveOneWay: {
      title: 'Односторонній пошук', // N-to-1 retrieval
      description: 'На основі намірів користувача та описів Знань Агент самостійно вибирає найкращі Знання для запитів. Найкраще підходить для застосунків з окремими, обмеженими Знаннями.',
    },
    retrieveMultiWay: {
      title: 'Багатосторонній пошук', // Multi-path retrieval
      description: 'На основі намірів користувача запитує по всіх Базах Знань, отримує релевантний текст із кількох джерел і вибирає найкращі результати, що відповідають запиту користувача, після переранжування. Необхідна конфігурація API моделі переранжування.',
    },
    // Rerank model is required
    rerankModelRequired: 'Необхідна модель переранжування',
    // Params
    params: 'Параметри',
    // Top K
    top_k: 'Найкращих K',
    top_kTip: 'Використовується для фільтрації фрагментів, найбільш схожих на запитання користувачів. Система також динамічно регулюватиме значення K у відповідності з max_tokens обраної моделі.',
    // Score Threshold
    score_threshold: 'Поріг оцінки',
    score_thresholdTip: 'Використовується для встановлення порогу схожості для фільтрації фрагментів.',
    // Modifying...
    retrieveChangeTip: 'Зміна  режиму індексування та режиму отримання може вплинути на застосунки, пов’язані з цими знаннями.',
    embeddingModelRequired: 'Потрібна налаштована модель вбудовування',
  },
  // Debug as Single Model
  debugAsSingleModel: 'Налагодження як одна модель',
  // Debug as Multiple Models
  debugAsMultipleModel: 'Налагодження як багато моделей',
  // Duplicate
  duplicateModel: 'Дублювання',
  // Publish as
  publishAs: 'Опублікувати як',
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
  codegen: {
    generatedCodeTitle: 'Згенерований код',
    generate: 'Генерувати',
    title: 'Генератор коду',
    loading: 'Генерація коду...',
    instruction: 'Інструкції',
    applyChanges: 'Застосувати зміни',
    resTitle: 'Згенерований код',
    noDataLine2: 'Тут з\'явиться попередній перегляд коду.',
    noDataLine1: 'Опишіть свій випадок використання зліва,',
    apply: 'Застосовувати',
    overwriteConfirmTitle: 'Перезаписати існуючий код?',
    overwriteConfirmMessage: 'Ця дія перезапише існуючий код. Хочете продовжити?',
    instructionPlaceholder: 'Введіть детальний опис коду, який ви хочете згенерувати.',
    description: 'Генератор коду використовує налаштовані моделі для генерації високоякісного коду на основі ваших інструкцій. Будь ласка, надайте чіткі та детальні інструкції.',
  },
  generate: {
    template: {
      pythonDebugger: {
        name: 'Налагоджувач Python',
        instruction: 'Бот, який може генерувати та налагоджувати ваш код на основі ваших інструкцій',
      },
      translation: {
        name: 'Переклад',
        instruction: 'Перекладач, який може перекладати кількома мовами',
      },
      professionalAnalyst: {
        name: 'Професійний аналітик',
        instruction: 'Отримуйте аналітичні дані, виявляйте ризики та перетворюйте ключову інформацію з довгих звітів в єдину записку',
      },
      excelFormulaExpert: {
        name: 'Експерт з формул Excel',
        instruction: 'Чат-бот, який може допомогти користувачам-початківцям розуміти, використовувати та створювати формули Excel на основі інструкцій користувача',
      },
      travelPlanning: {
        name: 'Планування подорожей',
        instruction: 'Помічник із планування подорожей — це інтелектуальний інструмент, розроблений, щоб допомогти користувачам без зусиль планувати свої поїздки',
      },
      SQLSorcerer: {
        name: 'SQL чаклун',
        instruction: 'Перетворюйте повсякденну мову на SQL-запити',
      },
      GitGud: {
        name: 'Git gud',
        instruction: 'Генеруйте відповідні команди Git на основі описаних користувачем дій контролю версій',
      },
      meetingTakeaways: {
        name: 'Підсумки зустрічі',
        instruction: 'Перетворіть зустрічі на стислі підсумки, включаючи теми для обговорення, ключові висновки та пункти дій',
      },
      writingsPolisher: {
        name: 'Письменницька полірувальна машина',
        instruction: 'Використовуйте передові методи редагування тексту, щоб покращити свої тексти',
      },
    },
    instruction: 'Інструкції',
    generate: 'Генерувати',
    apply: 'Застосовувати',
    tryIt: 'Спробуйте',
    overwriteTitle: 'Змінити існуючу конфігурацію?',
    loading: 'Оркестрування програми для вас...',
    resTitle: 'Згенерований запит',
    title: 'Генератор підказок',
    overwriteMessage: 'Застосування цього рядка замінить існуючу конфігурацію.',
    description: 'Генератор підказок використовує налаштовану модель для оптимізації запитів для кращої якості та кращої структури. Напишіть, будь ласка, зрозумілу та детальну інструкцію.',
    versions: 'Версії',
    version: 'Версія',
    press: 'Пресa',
    optional: 'Необов\'язково',
    dismiss: 'Відхилити',
    to: 'до',
    latest: 'Останні новини',
    idealOutput: 'Ідеальний вихід',
    insertContext: 'вставте контекст',
    optimizePromptTooltip: 'Оптимізувати в генераторі запитів',
    optimizationNote: 'Примітка щодо оптимізації',
    instructionPlaceHolderTitle: 'Опишіть, як би ви хотіли покращити цей запит. Наприклад:',
    instructionPlaceHolderLine3: 'Тон занадто жорсткий, будь ласка, зробіть його більш дружнім.',
    instructionPlaceHolderLine2: 'Формат виводу неправильний, будь ласка, суворо дотримуйтесь формату JSON.',
    newNoDataLine1: 'Напишіть інструкцію в лівій колонці та натисніть Генерувати, щоб побачити відповідь.',
    instructionPlaceHolderLine1: 'Зробіть вихідні дані більш стислими, зберігаючи основні моменти.',
    idealOutputPlaceholder: 'Опишіть свій ідеальний формат відповіді, довжину, тон та вимоги до змісту...',
    codeGenInstructionPlaceHolderLine: 'Чим детальнішим буде зворотний зв\'язок, наприклад, типи даних вхідних та вихідних даних, а також спосіб обробки змінних, тим точнішою буде генерація коду.',
  },
  warningMessage: {
    timeoutExceeded: 'Результати не відображаються через тайм-аут. Будь ласка, зверніться до журналів, щоб отримати повні результати.',
  },
  noResult: 'Тут буде відображено вихідні дані.',
}

export default translation
