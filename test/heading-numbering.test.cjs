const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.resolve(__dirname, '../src/heading-numbering-core.js');
test('Chinese counts beyond ten are canonical', () => {
  const { chineseNumber } = require(modulePath);
  assert.deepEqual([10,11,20,21,99,100,101,110,111,1001,1010,10000,10001].map(chineseNumber),
    ['十','十一','二十','二十一','九十九','一百','一百零一','一百一十','一百一十一','一千零一','一千零一十','一万','一万零一']);
});
test('skipped ancestors normalize to one, reset per parent, never include H1', () => {
  const { numberHeadings } = require(modulePath);
  assert.deepEqual(numberHeadings([4,4,3,6,2,6,1,6].map(level=>({level,title:'x'}))),
    ['1.1.1 ','1.1.2 ','1.2 ','1.2.1.1.1 ','2. ','2.1.1.1.1 ','一、','1.1.1.1.1 ']);
});
test('explicit manual prefixes remain intact and still consume an ordinal', () => {
  const { numberHeadings } = require(modulePath);
  const headings = [{level:1,title:'一、资源网站'},{level:2,title:'1. 网站'},{level:2,title:'2、 网站'},
    {level:3,title:'2.1 网站'},{level:2,title:'普通标题'},{level:1,title:'2026 年度回顾'},
    {level:2,title:'2026. 年报'},{level:2,title:'3D 渲染'},{level:2,title:'1.5 倍速'},{level:3,title:'1.5 标题'}];
  const original = JSON.stringify(headings);
  assert.deepEqual(numberHeadings(headings), ['', '', '', '', '3. ', '二、', '1. ', '2. ', '3. ', '']);
  assert.equal(JSON.stringify(headings),original);
});
test('heading numbers follow H1 Chinese / H2-rooted decimal hierarchy', () => {
  assert.ok(fs.existsSync(modulePath), 'shared numbering module exists');
  const { numberHeadings } = require(modulePath);
  const levels = [1,2,2,2,3,4,5,6,3,2,3,1,2,3];
  assert.deepEqual(numberHeadings(levels.map(level => ({level,title:'标题'}))),
    ['一、','1. ','2. ','3. ','3.1 ','3.1.1 ','3.1.1.1 ','3.1.1.1.1 ','3.2 ','4. ','4.1 ','二、','1. ','1.1 ']);
});
