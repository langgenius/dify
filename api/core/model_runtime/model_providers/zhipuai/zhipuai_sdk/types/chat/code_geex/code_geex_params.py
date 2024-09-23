from typing import Literal, Optional

from typing_extensions import Required, TypedDict

__all__ = [
    "CodeGeexTarget",
    "CodeGeexContext",
    "CodeGeexExtra",
]


class CodeGeexTarget(TypedDict, total=False):
    """补全的内容参数"""

    path: Optional[str]
    """文件路径"""
    language: Required[
        Literal[
            "c",
            "c++",
            "cpp",
            "c#",
            "csharp",
            "c-sharp",
            "css",
            "cuda",
            "dart",
            "lua",
            "objectivec",
            "objective-c",
            "objective-c++",
            "python",
            "perl",
            "prolog",
            "swift",
            "lisp",
            "java",
            "scala",
            "tex",
            "jsx",
            "tsx",
            "vue",
            "markdown",
            "html",
            "php",
            "js",
            "javascript",
            "typescript",
            "go",
            "shell",
            "rust",
            "sql",
            "kotlin",
            "vb",
            "ruby",
            "pascal",
            "r",
            "fortran",
            "lean",
            "matlab",
            "delphi",
            "scheme",
            "basic",
            "assembly",
            "groovy",
            "abap",
            "gdscript",
            "haskell",
            "julia",
            "elixir",
            "excel",
            "clojure",
            "actionscript",
            "solidity",
            "powershell",
            "erlang",
            "cobol",
            "alloy",
            "awk",
            "thrift",
            "sparql",
            "augeas",
            "cmake",
            "f-sharp",
            "stan",
            "isabelle",
            "dockerfile",
            "rmarkdown",
            "literate-agda",
            "tcl",
            "glsl",
            "antlr",
            "verilog",
            "racket",
            "standard-ml",
            "elm",
            "yaml",
            "smalltalk",
            "ocaml",
            "idris",
            "visual-basic",
            "protocol-buffer",
            "bluespec",
            "applescript",
            "makefile",
            "tcsh",
            "maple",
            "systemverilog",
            "literate-coffeescript",
            "vhdl",
            "restructuredtext",
            "sas",
            "literate-haskell",
            "java-server-pages",
            "coffeescript",
            "emacs-lisp",
            "mathematica",
            "xslt",
            "zig",
            "common-lisp",
            "stata",
            "agda",
            "ada",
        ]
    ]
    """代码语言类型，如python"""
    code_prefix: Required[str]
    """补全位置的前文"""
    code_suffix: Required[str]
    """补全位置的后文"""


class CodeGeexContext(TypedDict, total=False):
    """附加代码"""

    path: Required[str]
    """附加代码文件的路径"""
    code: Required[str]
    """附加的代码内容"""


class CodeGeexExtra(TypedDict, total=False):
    target: Required[CodeGeexTarget]
    """补全的内容参数"""
    contexts: Optional[list[CodeGeexContext]]
    """附加代码"""
