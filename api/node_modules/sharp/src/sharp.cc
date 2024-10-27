// Copyright 2013 Lovell Fuller and others.
// SPDX-License-Identifier: Apache-2.0

#include <mutex>  // NOLINT(build/c++11)

#include <napi.h>
#include <vips/vips8>

#include "common.h"
#include "metadata.h"
#include "pipeline.h"
#include "utilities.h"
#include "stats.h"

Napi::Object init(Napi::Env env, Napi::Object exports) {
  static std::once_flag sharp_vips_init_once;
  std::call_once(sharp_vips_init_once, []() {
    vips_init("sharp");
  });

  g_log_set_handler("VIPS", static_cast<GLogLevelFlags>(G_LOG_LEVEL_WARNING),
    static_cast<GLogFunc>(sharp::VipsWarningCallback), nullptr);

  // Methods available to JavaScript
  exports.Set("metadata", Napi::Function::New(env, metadata));
  exports.Set("pipeline", Napi::Function::New(env, pipeline));
  exports.Set("cache", Napi::Function::New(env, cache));
  exports.Set("concurrency", Napi::Function::New(env, concurrency));
  exports.Set("counters", Napi::Function::New(env, counters));
  exports.Set("simd", Napi::Function::New(env, simd));
  exports.Set("libvipsVersion", Napi::Function::New(env, libvipsVersion));
  exports.Set("format", Napi::Function::New(env, format));
  exports.Set("block", Napi::Function::New(env, block));
  exports.Set("_maxColourDistance", Napi::Function::New(env, _maxColourDistance));
  exports.Set("_isUsingJemalloc", Napi::Function::New(env, _isUsingJemalloc));
  exports.Set("stats", Napi::Function::New(env, stats));
  return exports;
}

NODE_API_MODULE(sharp, init)
