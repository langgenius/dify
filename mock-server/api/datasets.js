const registerAPI = function (app) {
  app.get("/datasets/:id/documents", async (req, res) => {
    if (req.params.id === "0") res.send({ data: [] });
    else {
      res.send({
        data: [
          {
            id: 1,
            name: "Steve Jobs' life",
            words: "70k",
            word_count: 100,
            updated_at: 1681801029,
            indexing_status: "completed",
            archived: true,
            enabled: false,
            data_source_info: {
              upload_file: {
                //             id: string
                // name: string
                // size: number
                // mime_type: string
                // created_at: number
                // created_by: string
                extension: "pdf",
              },
            },
          },
          {
            id: 2,
            name: "Steve Jobs' life",
            word_count: "10k",
            hit_count: 10,
            updated_at: 1681801029,
            indexing_status: "waiting",
            archived: true,
            enabled: false,
            data_source_info: {
              upload_file: {
                extension: "json",
              },
            },
          },
          {
            id: 3,
            name: "Steve Jobs' life xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            word_count: "100k",
            hit_count: 0,
            updated_at: 1681801029,
            indexing_status: "indexing",
            archived: false,
            enabled: true,
            data_source_info: {
              upload_file: {
                extension: "txt",
              },
            },
          },
          {
            id: 4,
            name: "Steve Jobs' life xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            word_count: "100k",
            hit_count: 0,
            updated_at: 1681801029,
            indexing_status: "splitting",
            archived: false,
            enabled: true,
            data_source_info: {
              upload_file: {
                extension: "md",
              },
            },
          },
          {
            id: 5,
            name: "Steve Jobs' life",
            word_count: "100k",
            hit_count: 0,
            updated_at: 1681801029,
            indexing_status: "error",
            archived: false,
            enabled: false,
            data_source_info: {
              upload_file: {
                extension: "html",
              },
            },
          },
        ],
        total: 100,
        id: req.params.id,
      });
    }
  });

  app.get("/datasets/:id/documents/:did/segments", async (req, res) => {
    if (req.params.id === "0") res.send({ data: [] });
    else {
      res.send({
        data: new Array(100).fill({
          id: 1234,
          content: `他的坚持让我很为难。众所周知他非常注意保护自己的隐私，而我想他应该从来没有看过我写的书。也许将来的某个时候吧，我还是这么说。但是，到了2009年，他的妻子劳伦·鲍威尔（Laurene Powell）直言不讳地对我说：“如果你真的打算写一本关于史蒂夫的书，最好现在就开始。”他当时刚刚第二次因病休假。我向劳伦坦承，当乔布斯第一次提出这个想法时，我并不知道他病了。几乎没有人知道，她说。他是在接受癌症手术之前给我打的电话，直到今天他还将此事作为一个秘密，她这么解释道。\n
            他的坚持让我很为难。众所周知他非常注意保护自己的隐私，而我想他应该从来没有看过我写的书。也许将来的某个时候吧，我还是这么说。但是，到了2009年，他的妻子劳伦·鲍威尔（Laurene Powell）直言不讳地对我说：“如果你真的打算写一本关于史蒂夫的书，最好现在就开始。”他当时刚刚第二次因病休假。我向劳伦坦承，当乔布斯第一次提出这个想法时，我并不知道他病了。几乎没有人知道，她说。他是在接受癌症手术之前给我打的电话，直到今天他还将此事作为一个秘密，她这么解释道。`,
          enabled: true,
          keyWords: [
            "劳伦·鲍威尔",
            "劳伦·鲍威尔",
            "手术",
            "秘密",
            "癌症",
            "乔布斯",
            "史蒂夫",
            "书",
            "休假",
            "坚持",
            "隐私",
          ],
          word_count: 120,
          hit_count: 100,
          status: "ok",
          index_node_hash: "index_node_hash value",
        }),
        limit: 100,
        has_more: true,
      });
    }
  });

  // get doc detail
  app.get("/datasets/:id/documents/:did", async (req, res) => {
    const fixedParams = {
      // originInfo: {
      originalFilename: "Original filename",
      originalFileSize: "16mb",
      uploadDate: "2023-01-01",
      lastUpdateDate: "2023-01-05",
      source: "Source",
      // },
      // technicalParameters: {
      segmentSpecification: "909090",
      segmentLength: 100,
      avgParagraphLength: 130,
    };
    const bookData = {
      doc_type: "book",
      doc_metadata: {
        title: "机器学习实战",
        language: "zh",
        author: "Peter Harrington",
        publisher: "人民邮电出版社",
        publicationDate: "2013-01-01",
        ISBN: "9787115335500",
        category: "技术",
      },
    };
    const webData = {
      doc_type: "webPage",
      doc_metadata: {
        title: "深度学习入门教程",
        url: "https://www.example.com/deep-learning-tutorial",
        language: "zh",
        publishDate: "2020-05-01",
        authorPublisher: "张三",
        topicsKeywords: "深度学习, 人工智能, 教程",
        description:
          "这是一篇详细的深度学习入门教程，适用于对人工智能和深度学习感兴趣的初学者。",
      },
    };
    const postData = {
      doc_type: "socialMediaPost",
      doc_metadata: {
        platform: "Twitter",
        authorUsername: "example_user",
        publishDate: "2021-08-15",
        postURL: "https://twitter.com/example_user/status/1234567890",
        topicsTags:
          "AI, DeepLearning, Tutorial, Example, Example2, Example3, AI, DeepLearning, Tutorial, Example, Example2, Example3, AI, DeepLearning, Tutorial, Example, Example2, Example3,",
      },
    };
    res.send({
      id: "550e8400-e29b-41d4-a716-446655440000",
      position: 1,
      dataset_id: "550e8400-e29b-41d4-a716-446655440002",
      data_source_type: "upload_file",
      data_source_info: {
        upload_file: {
          extension: "html",
          id: "550e8400-e29b-41d4-a716-446655440003",
        },
      },
      dataset_process_rule_id: "550e8400-e29b-41d4-a716-446655440004",
      batch: "20230410123456123456",
      name: "example_document",
      created_from: "web",
      created_by: "550e8400-e29b-41d4-a716-446655440005",
      created_api_request_id: "550e8400-e29b-41d4-a716-446655440006",
      created_at: 1671269696,
      processing_started_at: 1671269700,
      word_count: 11,
      parsing_completed_at: 1671269710,
      cleaning_completed_at: 1671269720,
      splitting_completed_at: 1671269730,
      tokens: 10,
      indexing_latency: 5.0,
      completed_at: 1671269740,
      paused_by: null,
      paused_at: null,
      error: null,
      stopped_at: null,
      indexing_status: "completed",
      enabled: true,
      disabled_at: null,
      disabled_by: null,
      archived: false,
      archived_reason: null,
      archived_by: null,
      archived_at: null,
      updated_at: 1671269740,
      ...(req.params.did === "book"
        ? bookData
        : req.params.did === "web"
        ? webData
        : req.params.did === "post"
        ? postData
        : {}),
      segment_count: 10,
      hit_count: 9,
      status: "ok",
    });
  });

  //   // logout
  //   app.get("/logout", async (req, res) => {
  //     res.send({
  //       result: "success",
  //     });
  //   });

  //   // Langgenius version
  //   app.get("/version", async (req, res) => {
  //     res.send({
  //       current_version: "v1.0.0",
  //       latest_version: "v1.0.0",
  //       upgradeable: true,
  //       compatible_upgrade: true,
  //     });
  //   });
};

module.exports = registerAPI;
