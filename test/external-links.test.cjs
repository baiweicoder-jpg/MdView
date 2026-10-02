const test=require('node:test');
const assert=require('node:assert/strict');
test('external link policy rejects repaired empty authorities',()=>{
  const {validTarget}=require('../src/external-links.js');
  for(const url of ['https:///example.invalid/a','https:////example.invalid/a','http:////example.invalid','https://?example.invalid','https://#example.invalid'])assert.equal(validTarget(url),null,url);
});
test('external link policy validates http(s) only and preserves exact target bytes',()=>{
  let links={};try{links=require('../src/external-links.js');}catch{}
  assert.equal(typeof links.validTarget,'function','shared renderer/main URL policy exists');
  for(const url of ['https://example.invalid/a?x=%2f#Part','HTTP://example.invalid:80/a','https://example.invalid/中文?q=空格'])assert.equal(links.validTarget(url),url);
  for(const url of ['app://view','custom:command','https://name:password@example.invalid/','https://name@example.invalid/','https://@example.invalid/','javascript:alert(1)','data:text/html,x','file:///C:/secret','mailto:x@example.invalid','//example.invalid','https:example.invalid','https:\\example.invalid',' https://example.invalid','https://example.invalid\n','ht\ttps://example.invalid','https://','https://example.invalid/'+ 'x'.repeat(8192),null,{},'#part'])assert.equal(links.validTarget(url),null,String(url));
});
