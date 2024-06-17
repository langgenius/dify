"use strict";
let https = require("https");

let subscriptionKey = "";
let host = "api.bing.microsoft.com";
let path = "/v7.0/images/search";
let search = "dogs and books";
let request_params = {
  method: "GET",
  hostname: host,
  path: path + "?q=" + encodeURIComponent(search),
  headers: {
    "Ocp-Apim-Subscription-Key": subscriptionKey,
  },
};

let response_handler = function (response) {
  let body = "";

  response.on("data", function (d) {
    body += d;
    console.log(body);
  });

  //   response.on("end", function (imageResults) {
  //     let firstImageResult = imageResults.value[0];
  //     console.log(`Image result count: ${imageResults.value.length}`);
  //     console.log(`First image thumbnail url: ${firstImageResult.thumbnailUrl}`);
  //     console.log(`First image web search url: ${firstImageResult.webSearchUrl}`);
  //   });
};

let req = https.request(request_params, response_handler);
req.end();
