/*!-----------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Version: 0.46.0(21007360cad28648bdf46282a2592cb47c3a7a6f)
 * Released under the MIT license
 * https://github.com/microsoft/monaco-editor/blob/main/LICENSE.txt
 *-----------------------------------------------------------------------------*/
define("vs/basic-languages/azcli/azcli", ["require","require"],(require)=>{
"use strict";var moduleExports=(()=>{var s=Object.defineProperty;var i=Object.getOwnPropertyDescriptor;var r=Object.getOwnPropertyNames;var l=Object.prototype.hasOwnProperty;var c=(t,e)=>{for(var o in e)s(t,o,{get:e[o],enumerable:!0})},k=(t,e,o,a)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of r(e))!l.call(t,n)&&n!==o&&s(t,n,{get:()=>e[n],enumerable:!(a=i(e,n))||a.enumerable});return t};var p=t=>k(s({},"__esModule",{value:!0}),t);var d={};c(d,{conf:()=>f,language:()=>g});var f={comments:{lineComment:"#"}},g={defaultToken:"keyword",ignoreCase:!0,tokenPostfix:".azcli",str:/[^#\s]/,tokenizer:{root:[{include:"@comment"},[/\s-+@str*\s*/,{cases:{"@eos":{token:"key.identifier",next:"@popall"},"@default":{token:"key.identifier",next:"@type"}}}],[/^-+@str*\s*/,{cases:{"@eos":{token:"key.identifier",next:"@popall"},"@default":{token:"key.identifier",next:"@type"}}}]],type:[{include:"@comment"},[/-+@str*\s*/,{cases:{"@eos":{token:"key.identifier",next:"@popall"},"@default":"key.identifier"}}],[/@str+\s*/,{cases:{"@eos":{token:"string",next:"@popall"},"@default":"string"}}]],comment:[[/#.*$/,{cases:{"@eos":{token:"comment",next:"@popall"}}}]]}};return p(d);})();
return moduleExports;
});
