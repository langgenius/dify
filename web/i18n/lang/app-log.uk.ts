const translation = {
  title: 'Журнали', // Logs
  description: 'Журнали фіксують стан роботи застосунку, включаючи введення користувача та відповіді ШІ.', // The logs record...
  dateTimeFormat: 'MM/DD/YYYY hh:mm A', // (Keep date format as is)
  table: {
    header: {
      time: 'Час', // Time
      endUser: 'Кінцевий користувач', // End User
      input: 'Введення', // Input
      output: 'Виведення', // Output
      summary: 'Заголовок', // Title
      messageCount: 'Кількість повідомлень', // Message Count
      userRate: 'Оцінка користувача', // User Rate
      adminRate: 'Оцінка адміністратора', // Op. Rate
    },
    pagination: {
      previous: 'Назад', // Prev
      next: 'Далі', // Next
    },
    empty: {
      noChat: 'Ще немає розмови', // No conversation yet
      noOutput: 'Відповіді немає', // No output
      element: {
        title: 'Хто-небудь тут є?', // Is anyone there?
        content: 'Спостерігайте й коментуйте взаємодію між кінцевими користувачами та програмами штучного інтелекту, щоб постійно покращувати точність ШІ. Ви можете спробувати <shareLink>поділитися</shareLink> або <testLink>тестувати</testLink> веб-програму самостійно, а потім повернутися на цю сторінку.',
      },
    },
  },
  detail: {
    time: 'Час', // Time
    conversationId: 'Ідентифікатор розмови', // Conversation ID
    promptTemplate: 'Шаблон підказки', // Prompt Template
    promptTemplateBeforeChat: 'Шаблон підказки перед чатом · як системне повідомлення', // Prompt Template Before Chat...
    annotationTip: 'Покращення, позначені {{user}}', // Improvements Marked by {{user}}
    timeConsuming: '',
    second: 'с', // s (seconds)
    tokenCost: 'Витрачені токени', // Token spent
    loading: 'Завантаження', // loading
    operation: {
      like: 'Вподобати', // like
      dislike: 'Не вподобати', // dislike
      addAnnotation: 'Додати покращення', // Add Improvement
      editAnnotation: 'Редагувати покращення', // Edit Improvement
      annotationPlaceholder: 'Введіть очікувану відповідь, яку ви хочете, щоб відповів ШІ. ',
    },
    variables: 'Змінні', // Variables
    uploadImages: 'Завантажені зображення', // Uploaded Images
  },
  filter: {
    period: {
      today: 'Сьогодні', // Today
      last7days: 'Останні 7 днів', // Last 7 Days
      last4weeks: 'Останні 4 тижні', // Last 4 weeks
      last3months: 'Останні 3 місяці', // Last 3 months
      last12months: 'Останні 12 місяців', // Last 12 months
      monthToDate: 'Місяць до дати', // Month to date
      quarterToDate: 'Квартал до дати', // Quarter to date
      yearToDate: 'Рік до дати', // Year to date
      allTime: 'Увесь час', // All time
    },
    annotation: {
      all: 'Усі', // All
      annotated: 'Анотовані покращення ({{count}} елементів)', // Annotated Improvements...
      not_annotated: 'Не анотований', // Not Annotated
    },
  },
}

export default translation
