const translation = {
  creation: {
    createFromScratch: {
      title: 'Boş bilgi hattı',
      description: 'Veri işleme ve yapı üzerinde tam denetime sahip sıfırdan özel bir işlem hattı oluşturun.',
    },
    createKnowledge: 'Bilgi Oluştur',
    caution: 'Dikkat',
    successTip: 'Başarıyla bir Bilgi Bankası oluşturuldu',
    errorTip: 'Bilgi Bankası oluşturulamadı',
    importDSL: 'DSL dosyasından içe aktarma',
    backToKnowledge: 'Bilgiye Geri Dön',
  },
  templates: {
    customized: 'Özel -leştirilmiş',
  },
  operations: {
    details: 'Şey',
    preview: 'Önizleme',
    choose: 'Seçmek',
    dataSource: 'Veri Kaynağı',
    convert: 'Dönüştürmek',
    saveAndProcess: 'Kaydet ve İşle',
    useTemplate: 'Bu Bilgi İşlem Hattını kullanın',
    backToDataSource: 'Veri Kaynağına Geri Dön',
    exportPipeline: 'Boru Hattını Dışa Aktar',
    editInfo: 'Bilgileri düzenle',
    process: 'İşlem',
  },
  deletePipeline: {
    title: 'Bu işlem hattı şablonunu sildiğinizden emin misiniz?',
    content: 'İşlem hattı şablonunun silinmesi geri alınamaz.',
  },
  publishPipeline: {
    success: {
      message: 'Bilgi İşlem Hattı Yayımlandı',
    },
    error: {
      message: 'Bilgi İşlem Hattı yayımlanamadı',
    },
  },
  publishTemplate: {
    success: {
      message: 'İşlem hattı şablonu yayımlandı',
      tip: 'Bu şablonu oluşturma sayfasında kullanabilirsiniz.',
      learnMore: 'Daha fazla bilgi edinin',
    },
    error: {
      message: 'İşlem hattı şablonu yayımlanamadı',
    },
  },
  exportDSL: {
    successTip: 'İşlem hattı DSL\'sini başarıyla dışarı aktarın',
    errorTip: 'İşlem hattı DSL\'si dışarı aktarılamadı',
  },
  details: {
    structure: 'Yapı',
    structureTooltip: 'Yığın Yapısı, belgelerin nasıl bölündüğünü ve dizine eklendiğini belirler (Genel, Üst-Alt ve Soru-Cevap modları sunar) ve her bilgi bankası için benzersizdir.',
  },
  testRun: {
    steps: {
      documentProcessing: 'Belge İşleme',
      dataSource: 'Veri Kaynağı',
    },
    dataSource: {
      localFiles: 'Yerel Dosyalar',
    },
    notion: {
      title: 'Notion Sayfalarını Seçin',
      docTitle: 'Kavram belgeleri',
    },
    title: 'Test Çalıştırması',
    tooltip: 'Test çalıştırması modunda, daha kolay hata ayıklama ve gözlem için aynı anda yalnızca bir belgenin içe aktarılmasına izin verilir.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Her giriş için benzersiz girişler',
      tooltip: 'Benzersiz Girişlere yalnızca seçilen veri kaynağı ve aşağı akış düğümleri tarafından erişilebilir. Kullanıcıların diğer veri kaynaklarını seçerken bu bilgileri doldurmaları gerekmez. İlk adımda (Veri Kaynağı) yalnızca veri kaynağı değişkenleri tarafından başvurulan giriş alanları görünecektir. Diğer tüm alanlar ikinci adımda (Belgeleri İşle) gösterilecektir.',
    },
    globalInputs: {
      title: 'Tüm girişler için Global Girişler',
      tooltip: 'Global Girişler tüm düğümler arasında paylaşılır. Kullanıcıların herhangi bir veri kaynağını seçerken bunları doldurmaları gerekecektir. Örneğin, sınırlayıcı ve maksimum öbek uzunluğu gibi alanlar birden çok veri kaynağına aynı şekilde uygulanabilir. İlk adımda (Veri Kaynağı) yalnızca Veri Kaynağı değişkenleri tarafından başvurulan giriş alanları görünür. Diğer tüm alanlar ikinci adımda (Belgeleri İşleme) gösterilir.',
    },
    preview: {
      stepOneTitle: 'Veri Kaynağı',
      stepTwoTitle: 'Süreç Belgeleri',
    },
    error: {
      variableDuplicate: 'Değişken adı zaten var. Lütfen farklı bir ad seçin.',
    },
    addInputField: 'Giriş Alanı Ekle',
    title: 'Kullanıcı Giriş Alanları',
    description: 'Kullanıcı giriş alanları, işlem hattı yürütme işlemi sırasında gerekli olan değişkenleri tanımlamak ve toplamak için kullanılır. Kullanıcılar, alan türünü özelleştirebilir ve giriş değerini farklı veri kaynaklarının veya belge işleme adımlarının ihtiyaçlarını karşılayacak şekilde esnek bir şekilde yapılandırabilir.',
    editInputField: 'Giriş Alanını Düzenle',
  },
  addDocuments: {
    steps: {
      processDocuments: 'Süreç Belgeleri',
      processingDocuments: 'Belgelerin İşlenmesi',
      chooseDatasource: 'Bir Veri Kaynağı Seçin',
    },
    stepOne: {
      preview: 'Önizleme',
    },
    stepTwo: {
      previewChunks: 'Öbek Öbeklerini Önizle',
      chunkSettings: 'Yığın Ayarları',
    },
    stepThree: {
      learnMore: 'Daha fazla bilgi edinin',
    },
    characters: 'Karakter',
    backToDataSource: 'Veri Kaynağı',
    title: 'Belge Ekle',
  },
  documentSettings: {
    title: 'Belge Ayarları',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      allFiles: 'Tüm Dosyalar',
      searchPlaceholder: 'Dosyaları ara...',
      allBuckets: 'Tüm Bulut Depolama Paketleri',
    },
    emptySearchResult: 'Hiçbir öğe bulunamadı',
    resetKeywords: 'Anahtar kelimeleri sıfırlama',
    notSupportedFileType: 'Bu dosya türü desteklenmiyor',
    emptyFolder: 'Bu klasör boş',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: 'Onay',
      content: 'Bu eylem kalıcıdır. Önceki yönteme geri dönemezsiniz. Dönüştürmek için lütfen onaylayın.',
    },
    warning: 'Bu işlem geri alınamaz.',
    title: 'Bilgi İşlem Hattına Dönüştür',
    errorMessage: 'Veri kümesi işlem hattına dönüştürülemedi',
    successMessage: 'Veri kümesi başarıyla işlem hattına dönüştürüldü',
    descriptionChunk2: '— Pazarımızdaki eklentilere erişim ile daha açık ve esnek bir yaklaşım. Bu, yeni işleme yöntemini gelecekteki tüm belgelere uygulayacaktır.',
    descriptionChunk1: 'Artık mevcut bilgi bankanızı belge işleme için Bilgi İşlem Hattı\'nı kullanacak şekilde dönüştürebilirsiniz',
  },
  knowledgePermissions: 'İzinler',
  inputField: 'Giriş Alanı',
  knowledgeDescription: 'Bilgi açıklaması',
  knowledgeNameAndIconPlaceholder: 'Lütfen Bilgi Bankasının adını giriniz',
  knowledgeNameAndIcon: 'Bilgi adı ve simgesi',
  pipelineNameAndIcon: 'İşlem hattı adı & simgesi',
  editPipelineInfo: 'İşlem hattı bilgilerini düzenleme',
  knowledgeDescriptionPlaceholder: 'Bu Bilgi Bankasında neler olduğunu açıklayın. Ayrıntılı bir açıklama, yapay zekanın veri kümesinin içeriğine daha doğru bir şekilde erişmesini sağlar. Boşsa, Dify varsayılan isabet stratejisini kullanacaktır. (İsteğe bağlı)',
}

export default translation
