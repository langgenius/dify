"use strict";
let https = require("https");

let subscriptionKey = "";
let host = "api.bing.microsoft.com";
let path = "/v7.0/entities";
const search = encodeURIComponent("seattle");
const count = 100;
const category = " ";
const request_params = {
  method: "GET",
  hostname: host,
  path: `${path}?q=${search}&mkt=en-US`,
  headers: {
    "Ocp-Apim-Subscription-Key": subscriptionKey,
  },
};

const response_handler = function (response) {
  let body = "";

  response.on("data", function (d) {
    body += d;
  });

  response.on("end", function () {
    console.log(body);
  });
};

const req = https.request(request_params, response_handler);
req.end();
