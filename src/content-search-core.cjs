const { searchTextBlocks } = require('./markdown.cjs');
const MAX_HITS = 500;
function searchSource(source, query, caseSensitive = false, limit = MAX_HITS) {
  const hits = []; let total = 0;
  if (!query) return { hits, total };
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, caseSensitive ? 'gu' : 'giu');
  for (const [block, text] of searchTextBlocks(source).entries()) {
    pattern.lastIndex = 0;
    let ordinal = 0;
    for (let match; (match = pattern.exec(text));) {
      total++;
      if (hits.length < Math.min(MAX_HITS, Math.max(0, limit))) {
        const from = match.index, to = from + match[0].length;
        hits.push({ block, from, to, ordinal, snippet: text.slice(Math.max(0, from - 45), Math.min(text.length, to + 65)) });
      }
      ordinal++;
    }
  }
  return { hits, total };
}
module.exports = { searchSource, MAX_HITS };
