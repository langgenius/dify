const translation = {
  creation: {
    backToKnowledge: 'العودة إلى المعرفة',
    createFromScratch: {
      title: 'سير عمل معرفة فارغ',
      description: 'إنشاء سير عمل مخصص من الصفر مع التحكم الكامل في معالجة البيانات وهيكلها.',
    },
    importDSL: 'استيراد من ملف DSL',
    createKnowledge: 'إنشاء المعرفة',
    errorTip: 'فشل إنشاء قاعدة المعرفة',
    successTip: 'تم إنشاء قاعدة المعرفة بنجاح',
    caution: 'تنبيه',
  },
  templates: {
    customized: 'مخصص',
  },
  operations: {
    choose: 'اختر',
    details: 'التفاصيل',
    editInfo: 'تعديل المعلومات',
    useTemplate: 'استخدام سير عمل المعرفة هذا',
    backToDataSource: 'العودة إلى مصدر البيانات',
    process: 'معالجة',
    dataSource: 'مصدر البيانات',
    saveAndProcess: 'حفظ ومعالجة',
    preview: 'معاينة',
    exportPipeline: 'تصدير سير العمل',
    convert: 'تحويل',
  },
  knowledgeNameAndIcon: 'اسم وأيقونة المعرفة',
  knowledgeNameAndIconPlaceholder: 'يرجى إدخال اسم قاعدة المعرفة',
  knowledgeDescription: 'وصف المعرفة',
  knowledgeDescriptionPlaceholder: 'صف ما يوجد في قاعدة المعرفة هذه. يسمح الوصف التفصيلي للذكاء الاصطناعي بالوصول إلى محتوى مجموعة البيانات بشكل أكثر دقة. إذا كان فارغًا، فسيستخدم Dify استراتيجية المطابقة الافتراضية. (اختياري)',
  knowledgePermissions: 'أذونات',
  editPipelineInfo: 'تعديل معلومات سير العمل',
  pipelineNameAndIcon: 'اسم وأيقونة سير العمل',
  deletePipeline: {
    title: 'هل أنت متأكد من حذف قالب سير العمل هذا؟',
    content: 'حذف قالب سير العمل لا رجعة فيه.',
  },
  publishPipeline: {
    success: {
      message: 'تم نشر سير عمل المعرفة',
      tip: '<CustomLink>الذهاب إلى المستندات</CustomLink> لإضافة أو إدارة المستندات.',
    },
    error: {
      message: 'فشل نشر سير عمل المعرفة',
    },
  },
  publishTemplate: {
    success: {
      message: 'تم نشر قالب سير العمل',
      tip: 'يمكنك استخدام هذا القالب في صفحة الإنشاء.',
      learnMore: 'تعرف على المزيد',
    },
    error: {
      message: 'فشل نشر قالب سير العمل',
    },
  },
  exportDSL: {
    successTip: 'تم تصدير DSL لسير العمل بنجاح',
    errorTip: 'فشل تصدير DSL لسير العمل',
  },
  details: {
    createdBy: 'بواسطة {{author}}',
    structure: 'الهيكل',
    structureTooltip: 'يحدد هيكل القطعة كيفية تقسيم المستندات وفهرستها - تقديم أوضاع عامة، الأصل والطفل، والأسئلة والأجوبة - وهي فريدة لكل قاعدة معرفة.',
  },
  testRun: {
    title: 'تشغيل اختباري',
    tooltip: 'في وضع التشغيل الاختباري، يُسمح باستيراد مستند واحد فقط في كل مرة لسهولة التصحيح والملاحظة.',
    steps: {
      dataSource: 'مصدر البيانات',
      documentProcessing: 'معالجة المستندات',
    },
    dataSource: {
      localFiles: 'الملفات المحلية',
    },
    notion: {
      title: 'اختر صفحات Notion',
      docTitle: 'مستندات Notion',
    },
  },
  inputField: 'حقل الإدخال',
  inputFieldPanel: {
    title: 'حقول إدخال المستخدم',
    description: 'تُستخدم حقول إدخال المستخدم لتعريف وجمع المتغيرات المطلوبة أثناء عملية تنفيذ سير العمل. يمكن للمستخدمين تخصيص نوع الحقل وتكوين قيمة الإدخال بمرونة لتلبية احتياجات مصادر البيانات المختلفة أو خطوات معالجة المستندات.',
    uniqueInputs: {
      title: 'مدخلات فريدة لكل مدخل',
      tooltip: 'المدخلات الفريدة يمكن الوصول إليها فقط لمصدر البيانات المحدد وعقده النهائية. لن يحتاج المستخدمون إلى تعبئتها عند اختيار مصادر بيانات أخرى. ستظهر فقط حقول الإدخال المشار إليها بواسطة متغيرات مصدر البيانات في الخطوة الأولى (مصدر البيانات). ستظهر جميع الحقول الأخرى في الخطوة الثانية (معالجة المستندات).',
    },
    globalInputs: {
      title: 'مدخلات عالمية لجميع المداخل',
      tooltip: 'المدخلات العالمية مشتركة عبر جميع العقد. سيحتاج المستخدمون إلى تعبئتها عند اختيار أي مصدر بيانات. على سبيل المثال، يمكن تطبيق حقول مثل المحدد والحد الأقصى لطول القطعة بشكل موحد عبر مصادر بيانات متعددة. ستظهر فقط حقول الإدخال المشار إليها بواسطة متغيرات مصدر البيانات في الخطوة الأولى (مصدر البيانات). ستظهر جميع الحقول الأخرى في الخطوة الثانية (معالجة المستندات).',
    },
    addInputField: 'إضافة حقل إدخال',
    editInputField: 'تعديل حقل إدخال',
    preview: {
      stepOneTitle: 'مصدر البيانات',
      stepTwoTitle: 'معالجة المستندات',
    },
    error: {
      variableDuplicate: 'اسم المتغير موجود بالفعل. يرجى اختيار اسم مختلف.',
    },
  },
  addDocuments: {
    title: 'إضافة مستندات',
    steps: {
      chooseDatasource: 'اختر مصدر بيانات',
      processDocuments: 'معالجة المستندات',
      processingDocuments: 'جارٍ معالجة المستندات',
    },
    backToDataSource: 'مصدر البيانات',
    stepOne: {
      preview: 'معاينة',
    },
    stepTwo: {
      chunkSettings: 'إعدادات القطعة',
      previewChunks: 'معاينة القطع',
    },
    stepThree: {
      learnMore: 'تعرف على المزيد',
    },
    characters: 'أحرف',
    selectOnlineDocumentTip: 'معالجة ما يصل إلى {{count}} صفحة',
    selectOnlineDriveTip: 'معالجة ما يصل إلى {{count}} ملف، بحد أقصى {{fileSize}} ميجابايت لكل منها',
  },
  documentSettings: {
    title: 'إعدادات المستند',
  },
  onlineDocument: {
    pageSelectorTitle: '{{name}} صفحات',
  },
  onlineDrive: {
    notConnected: '{{name}} غير متصل',
    notConnectedTip: 'للمزامنة مع {{name}}، يجب إنشاء اتصال بـ {{name}} أولاً.',
    breadcrumbs: {
      allBuckets: 'جميع حاويات التخزين السحابية',
      allFiles: 'جميع الملفات',
      searchResult: 'العثور على {{searchResultsLength}} عناصر في مجلد "{{folderName}}"',
      searchPlaceholder: 'بحث في الملفات...',
    },
    notSupportedFileType: 'نوع الملف هذا غير مدعوم',
    emptyFolder: 'هذا المجلد فارغ',
    emptySearchResult: 'لم يتم العثور على أي عناصر',
    resetKeywords: 'إعادة تعيين الكلمات الرئيسية',
  },
  credentialSelector: {
  },
  configurationTip: 'تكوين {{pluginName}}',
  conversion: {
    title: 'التحويل إلى سير عمل المعرفة',
    descriptionChunk1: 'يمكنك الآن تحويل قاعدة المعرفة الحالية لاستخدام سير عمل المعرفة لمعالجة المستندات',
    descriptionChunk2: ' - نهج أكثر انفتاحًا ومرونة مع الوصول إلى الإضافات من سوقنا. سيطبق هذا طريقة المعالجة الجديدة على جميع المستندات المستقبلية.',
    warning: 'لا يمكن التراجع عن هذا الإجراء.',
    confirm: {
      title: 'تأكيد',
      content: 'هذا الإجراء دائم. لن تتمكن من العودة إلى الطريقة السابقة. يرجى التأكيد للتحويل.',
    },
    errorMessage: 'فشل تحويل مجموعة البيانات إلى سير عمل',
    successMessage: 'تم تحويل مجموعة البيانات إلى سير عمل بنجاح',
  },
}

export default translation
