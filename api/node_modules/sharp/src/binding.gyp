# Copyright 2013 Lovell Fuller and others.
# SPDX-License-Identifier: Apache-2.0

{
  'variables': {
    'vips_version': '<!(node -p "require(\'../lib/libvips\').minimumLibvipsVersion")',
    'platform_and_arch': '<!(node -p "require(\'../lib/libvips\').buildPlatformArch()")',
    'sharp_libvips_version': '<!(node -p "require(\'../package.json\').optionalDependencies[\'@img/sharp-libvips-<(platform_and_arch)\']")',
    'sharp_libvips_yarn_locator': '<!(node -p "require(\'../lib/libvips\').yarnLocator()")',
    'sharp_libvips_include_dir': '<!(node -p "require(\'../lib/libvips\').buildSharpLibvipsIncludeDir()")',
    'sharp_libvips_cplusplus_dir': '<!(node -p "require(\'../lib/libvips\').buildSharpLibvipsCPlusPlusDir()")',
    'sharp_libvips_lib_dir': '<!(node -p "require(\'../lib/libvips\').buildSharpLibvipsLibDir()")'
  },
  'targets': [{
    'target_name': 'libvips-cpp',
    'conditions': [
      ['OS == "win"', {
        # Build libvips C++ binding for Windows due to MSVC std library ABI changes
        'type': 'shared_library',
        'defines': [
          'VIPS_CPLUSPLUS_EXPORTS',
          '_ALLOW_KEYWORD_MACROS'
        ],
        'sources': [
          '<(sharp_libvips_cplusplus_dir)/VConnection.cpp',
          '<(sharp_libvips_cplusplus_dir)/VError.cpp',
          '<(sharp_libvips_cplusplus_dir)/VImage.cpp',
          '<(sharp_libvips_cplusplus_dir)/VInterpolate.cpp',
          '<(sharp_libvips_cplusplus_dir)/VRegion.cpp'
        ],
        'include_dirs': [
          '<(sharp_libvips_include_dir)',
          '<(sharp_libvips_include_dir)/glib-2.0',
          '<(sharp_libvips_lib_dir)/glib-2.0/include'
        ],
        'link_settings': {
          'library_dirs': [
            '<(sharp_libvips_lib_dir)'
          ],
          'libraries': [
            'libvips.lib'
          ],
        },
        'configurations': {
          'Release': {
            'msvs_settings': {
              'VCCLCompilerTool': {
                'ExceptionHandling': 1,
                'Optimization': 1,
                'WholeProgramOptimization': 'true'
              },
              'VCLibrarianTool': {
                'AdditionalOptions': [
                  '/LTCG:INCREMENTAL'
                ]
              },
              'VCLinkerTool': {
                'ImageHasSafeExceptionHandlers': 'false',
                'OptimizeReferences': 2,
                'EnableCOMDATFolding': 2,
                'LinkIncremental': 1,
                'AdditionalOptions': [
                  '/LTCG:INCREMENTAL'
                ]
              }
            },
            'msvs_disabled_warnings': [
              4275
            ]
          }
        }
      }, {
        # Ignore this target for non-Windows
        'type': 'none'
      }]
    ]
  }, {
    'target_name': 'sharp-<(platform_and_arch)',
    'defines': [
      'NAPI_VERSION=9',
      'NODE_ADDON_API_DISABLE_DEPRECATED',
      'NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS'
    ],
    'dependencies': [
      '<!(node -p "require(\'node-addon-api\').gyp")',
      'libvips-cpp'
    ],
    'variables': {
      'conditions': [
        ['OS != "win"', {
          'pkg_config_path': '<!(node -p "require(\'../lib/libvips\').pkgConfigPath()")',
          'use_global_libvips': '<!(node -p "Boolean(require(\'../lib/libvips\').useGlobalLibvips()).toString()")'
        }, {
          'pkg_config_path': '',
          'use_global_libvips': ''
        }]
      ]
    },
    'sources': [
      'common.cc',
      'metadata.cc',
      'stats.cc',
      'operations.cc',
      'pipeline.cc',
      'utilities.cc',
      'sharp.cc'
    ],
    'include_dirs': [
      '<!(node -p "require(\'node-addon-api\').include_dir")',
    ],
    'conditions': [
      ['use_global_libvips == "true"', {
        # Use pkg-config for include and lib
        'include_dirs': ['<!@(PKG_CONFIG_PATH="<(pkg_config_path)" pkg-config --cflags-only-I vips-cpp vips glib-2.0 | sed s\/-I//g)'],
        'libraries': ['<!@(PKG_CONFIG_PATH="<(pkg_config_path)" pkg-config --libs vips-cpp)'],
        'defines': [
          'SHARP_USE_GLOBAL_LIBVIPS'
        ],
        'conditions': [
          ['OS == "linux"', {
            'defines': [
              # Inspect libvips-cpp.so to determine which C++11 ABI version was used and set _GLIBCXX_USE_CXX11_ABI accordingly. This is quite horrible.
              '_GLIBCXX_USE_CXX11_ABI=<!(if readelf -Ws "$(PKG_CONFIG_PATH="<(pkg_config_path)" pkg-config --variable libdir vips-cpp)/libvips-cpp.so" | c++filt | grep -qF __cxx11;then echo "1";else echo "0";fi)'
            ]
          }]
        ]
      }, {
        # Use pre-built libvips stored locally within node_modules
        'include_dirs': [
          '<(sharp_libvips_include_dir)',
          '<(sharp_libvips_include_dir)/glib-2.0',
          '<(sharp_libvips_lib_dir)/glib-2.0/include'
        ],
        'library_dirs': [
          '<(sharp_libvips_lib_dir)'
        ],
        'conditions': [
          ['OS == "win"', {
            'defines': [
              '_ALLOW_KEYWORD_MACROS',
              '_FILE_OFFSET_BITS=64'
            ],
            'link_settings': {
              'libraries': [
                'libvips.lib'
              ]
            }
          }],
          ['OS == "mac"', {
            'link_settings': {
              'libraries': [
                'libvips-cpp.42.dylib'
              ]
            },
            'xcode_settings': {
              'OTHER_LDFLAGS': [
                # Ensure runtime linking is relative to sharp.node
                '-Wl,-rpath,\'@loader_path/../../sharp-libvips-<(platform_and_arch)/lib\'',
                '-Wl,-rpath,\'@loader_path/../../../sharp-libvips-<(platform_and_arch)/<(sharp_libvips_version)/lib\'',
                '-Wl,-rpath,\'@loader_path/../../node_modules/@img/sharp-libvips-<(platform_and_arch)/lib\'',
                '-Wl,-rpath,\'@loader_path/../../../node_modules/@img/sharp-libvips-<(platform_and_arch)/lib\'',
                '-Wl,-rpath,\'@loader_path/../../../../../@img-sharp-libvips-<(platform_and_arch)-npm-<(sharp_libvips_version)-<(sharp_libvips_yarn_locator)/node_modules/@img/sharp-libvips-<(platform_and_arch)/lib\''
              ]
            }
          }],
          ['OS == "linux"', {
            'defines': [
              '_GLIBCXX_USE_CXX11_ABI=1'
            ],
            'link_settings': {
              'libraries': [
                '-l:libvips-cpp.so.42'
              ],
              'ldflags': [
                '-Wl,-s',
                '-Wl,--disable-new-dtags',
                '-Wl,-z,nodelete',
                '-Wl,-rpath=\'$$ORIGIN/../../sharp-libvips-<(platform_and_arch)/lib\'',
                '-Wl,-rpath=\'$$ORIGIN/../../../sharp-libvips-<(platform_and_arch)/<(sharp_libvips_version)/lib\'',
                '-Wl,-rpath=\'$$ORIGIN/../../node_modules/@img/sharp-libvips-<(platform_and_arch)/lib\'',
                '-Wl,-rpath=\'$$ORIGIN/../../../node_modules/@img/sharp-libvips-<(platform_and_arch)/lib\'',
                '-Wl,-rpath,\'$$ORIGIN/../../../../../@img-sharp-libvips-<(platform_and_arch)-npm-<(sharp_libvips_version)-<(sharp_libvips_yarn_locator)/node_modules/@img/sharp-libvips-<(platform_and_arch)/lib\''
              ]
            }
          }],
          ['OS == "emscripten"', {
            'product_extension': 'node.js',
            'link_settings': {
              'ldflags': [
                '-fexceptions',
                '--pre-js=<!(node -p "require.resolve(\'./emscripten/pre.js\')")',
                '-Oz',
                '-sALLOW_MEMORY_GROWTH',
                '-sENVIRONMENT=node',
                '-sEXPORTED_FUNCTIONS=["emnapiInit", "_vips_shutdown", "_uv_library_shutdown"]',
                '-sNODERAWFS',
                '-sTEXTDECODER=0',
                '-sWASM_ASYNC_COMPILATION=0',
                '-sWASM_BIGINT'
              ],
              'libraries': [
                '<!@(PKG_CONFIG_PATH="<!(node -p "require(\'@img/sharp-libvips-dev-wasm32/lib\')")/pkgconfig" pkg-config --static --libs vips-cpp)'
              ],
            }
          }]
        ]
      }]
    ],
    'cflags_cc': [
      '-std=c++0x',
      '-fexceptions',
      '-Wall',
      '-Os'
    ],
    'xcode_settings': {
      'CLANG_CXX_LANGUAGE_STANDARD': 'c++11',
      'MACOSX_DEPLOYMENT_TARGET': '10.13',
      'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
      'GCC_ENABLE_CPP_RTTI': 'YES',
      'OTHER_CPLUSPLUSFLAGS': [
        '-fexceptions',
        '-Wall',
        '-Oz'
      ]
    },
    'configurations': {
      'Release': {
        'conditions': [
          ['target_arch == "arm"', {
            'cflags_cc': [
              '-Wno-psabi'
            ]
          }],
          ['OS == "win"', {
            'msvs_settings': {
              'VCCLCompilerTool': {
                'ExceptionHandling': 1,
                'Optimization': 1,
                'WholeProgramOptimization': 'true'
              },
              'VCLibrarianTool': {
                'AdditionalOptions': [
                  '/LTCG:INCREMENTAL'
                ]
              },
              'VCLinkerTool': {
                'ImageHasSafeExceptionHandlers': 'false',
                'OptimizeReferences': 2,
                'EnableCOMDATFolding': 2,
                'LinkIncremental': 1,
                'AdditionalOptions': [
                  '/LTCG:INCREMENTAL'
                ]
              }
            },
            'msvs_disabled_warnings': [
              4275
            ]
          }]
        ]
      }
    },
  }, {
    'target_name': 'copy-dll',
    'type': 'none',
    'dependencies': [
      'sharp-<(platform_and_arch)'
    ],
    'conditions': [
      ['OS == "win"', {
        'copies': [{
          'destination': 'build/Release',
          'files': [
            '<(sharp_libvips_lib_dir)/libvips-42.dll'
          ]
        }]
      }]
    ]
  }]
}
