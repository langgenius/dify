/*!-----------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Version: 0.46.0(21007360cad28648bdf46282a2592cb47c3a7a6f)
 * Released under the MIT license
 * https://github.com/microsoft/monaco-editor/blob/main/LICENSE.txt
 *-----------------------------------------------------------------------------*/
define("vs/basic-languages/ini/ini", ["require","require"],(require)=>{
"use strict";var moduleExports=(()=>{var t=Object.defineProperty;var i=Object.getOwnPropertyDescriptor;var r=Object.getOwnPropertyNames;var g=Object.prototype.hasOwnProperty;var c=(n,e)=>{for(var s in e)t(n,s,{get:e[s],enumerable:!0})},l=(n,e,s,a)=>{if(e&&typeof e=="object"||typeof e=="function")for(let o of r(e))!g.call(n,o)&&o!==s&&t(n,o,{get:()=>e[o],enumerable:!(a=i(e,o))||a.enumerable});return n};var p=n=>l(t({},"__esModule",{value:!0}),n);var f={};c(f,{conf:()=>u,language:()=>m});var u={comments:{lineComment:"#"},brackets:[["{","}"],["[","]"],["(",")"]],autoClosingPairs:[{open:"{",close:"}"},{open:"[",close:"]"},{open:"(",close:")"},{open:'"',close:'"'},{open:"'",close:"'"}],surroundingPairs:[{open:"{",close:"}"},{open:"[",close:"]"},{open:"(",close:")"},{open:'"',close:'"'},{open:"'",close:"'"}]},m={defaultToken:"",tokenPostfix:".ini",escapes:/\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,tokenizer:{root:[[/^\[[^\]]*\]/,"metatag"],[/(^\w+)(\s*)(\=)/,["key","","delimiter"]],{include:"@whitespace"},[/\d+/,"number"],[/"([^"\\]|\\.)*$/,"string.invalid"],[/'([^'\\]|\\.)*$/,"string.invalid"],[/"/,"string",'@string."'],[/'/,"string","@string.'"]],whitespace:[[/[ \t\r\n]+/,""],[/^\s*[#;].*$/,"comment"]],string:[[/[^\\"']+/,"string"],[/@escapes/,"string.escape"],[/\\./,"string.escape.invalid"],[/["']/,{cases:{"$#==$S2":{token:"string",next:"@pop"},"@default":"string"}}]]}};return p(f);})();
return moduleExports;
});
