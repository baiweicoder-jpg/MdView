// Shared pure display numbering. Never modifies heading titles, slugs or source.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MdViewHeadingNumbering = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function chineseNumber(value) {
    const digits = '零一二三四五六七八九';
    if (value < 10) return digits[value];
    if (value < 100) return (value < 20 ? '' : digits[Math.floor(value / 10)]) + '十' + (value % 10 ? digits[value % 10] : '');
    for (const [unit, name] of [[100000000, '亿'], [10000, '万'], [1000, '千'], [100, '百']]) {
      if (value < unit) continue;
      const remainder = value % unit;
      return chineseNumber(Math.floor(value / unit)) + name + (remainder ? (remainder < unit / 10 ? '零' : '') + (remainder >= 10 && remainder < 20 ? '一' : '') + chineseNumber(remainder) : '');
    }
  }
  function hasManualPrefix(title, level) {
    const text = String(title || '').trimStart();
    // Only conventional, punctuated ordinals: never plain years or '3D'.
    if (/^[一二三四五六七八九十百千万亿零〇两]+、\s*\S/u.test(text)) return true;
    if (/^[1-9]\d{0,2}(?:、\s*|[.)]\s+)\S/u.test(text)) return true;
    // Decimal paths must have exactly the expected depth (H3=two parts).
    // This intentionally cannot distinguish '1.5 title' at H3 from a section.
    if (level < 3) return false;
    return new RegExp('^[1-9]\\d{0,2}(?:\\.[1-9]\\d{0,2}){' + (level - 2) + '}\\.?\\s+\\S', 'u').test(text);
  }
  function numberHeadings(headings) {
    const counts = [0, 0, 0, 0, 0, 0];
    return headings.map(({ level, title }) => {
      counts[level - 1]++;
      counts.fill(0, level);
      if (level === 1) return hasManualPrefix(title, level) ? '' : chineseNumber(counts[0]) + '、';
      // Missing H2–H5 ancestors start at one; never fabricate an H1.
      for (let ancestor = 1; ancestor < level - 1; ancestor++) counts[ancestor] ||= 1;
      return hasManualPrefix(title, level) ? '' : counts.slice(1, level).join('.') + (level === 2 ? '. ' : ' ');
    });
  }
  return { chineseNumber, numberHeadings };
});
