// Explicit Markdown metadata, not HTML or arbitrary CSS. Shared by both parsers.
const MIN_COLUMN_WIDTH = 50, MAX_COLUMN_WIDTH = 1600;
function parseWidths(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{1,3}(?:,[1-9]\d{1,3}){0,9999}$/.test(value)) return null;
  const widths = value.split(',').map(Number);
  return widths.every(n => Number.isSafeInteger(n) && n >= MIN_COLUMN_WIDTH && n <= MAX_COLUMN_WIDTH) ? widths : null;
}
function installWidthSyntax(md) {
  md.core.ruler.before('inline', 'table_widths', state => {
    const tokens = state.tokens;
    for (let i = 3; i < tokens.length; i++) {
      if (tokens[i].type !== 'table_open' || tokens[i-3].type !== 'paragraph_open' || tokens[i-2].type !== 'inline' || tokens[i-1].type !== 'paragraph_close' || tokens[i-3].level !== tokens[i].level) continue;
      const match = /^\{table-widths=([^}]+)\}$/.exec(tokens[i-2].content);
      const widths = match && parseWidths(match[1]);
      if (!widths) continue;
      let end = i + 1;
      while (end < tokens.length && tokens[end].type !== 'table_close') end++;
      const headers = tokens.slice(i,end).filter(t => t.type === 'th_open');
      if (headers.length !== widths.length) continue;
      tokens[i].meta = { ...tokens[i].meta, widths };
      let col = 0;
      for (let j = i + 1; j < end; j++) {
        if (tokens[j].type === 'tr_open') col = 0;
        if (['td_open','th_open'].includes(tokens[j].type)) tokens[j].attrSet('colwidth', String(widths[col++]));
      }
      tokens.splice(i-3,3); i -= 3;
    }
  });
  md.renderer.rules.table_open = (tokens, i, options, env, self) => {
    const widths = tokens[i].meta?.widths;
    if (!widths) return self.renderToken(tokens,i,options);
    tokens[i].attrSet('class', 'mdview-width-table');
    tokens[i].attrSet('width', String(widths.reduce((a,b)=>a+b,0)));
    return '<div class="mdview-table-scroll">' + self.renderToken(tokens,i,options) + '<colgroup>' + widths.map(w=>`<col width="${w}">`).join('') + '</colgroup>';
  };
  md.renderer.rules.table_close = (tokens,i,options,env,self) => {
    let opening = i - 1;
    while (opening >= 0 && tokens[opening].type !== 'table_open') opening--;
    return self.renderToken(tokens,i,options) + (tokens[opening]?.meta?.widths ? '</div>' : '');
  };
}
module.exports = { parseWidths, installWidthSyntax, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH };
