/* Small shared selection model; browser and Node regression tests use the same code. */
(function(root) {
  function create() {
    let selected = new Set(), anchor;
    return {
      ids: () => [...selected],
      has: id => selected.has(id),
      clear() { selected.clear(); anchor = undefined; },
      // Plain navigation exits batch mode; retain its anchor for a following Shift click.
      navigate(id) { selected.clear(); anchor = id; },
      scope(ids) { const scope = new Set(ids); selected = new Set([...selected].filter(id => scope.has(id))); if (!scope.has(anchor)) anchor = undefined; },
      all(ids) { selected = new Set(ids); anchor = ids[0]; },
      // Keyboard ranges replace the prior range so reversing direction can shrink it.
      move(origin, destination, ids, extend = false) {
        if (!ids.includes(origin) || !ids.includes(destination)) return;
        if (!extend) { anchor = destination; return; }
        if (!ids.includes(anchor)) anchor = origin;
        const start = ids.indexOf(anchor), end = ids.indexOf(destination);
        selected = new Set(ids.slice(Math.min(start, end), Math.max(start, end) + 1));
      },
      toggle(id, ids, range = false) {
        const start = ids.indexOf(anchor), end = ids.indexOf(id);
        if (range && start >= 0 && end >= 0) for (const key of ids.slice(Math.min(start,end),Math.max(start,end)+1)) selected.add(key);
        else { if (selected.has(id)) selected.delete(id); else selected.add(id); anchor = id; }
      }
    };
  }
  if (typeof module !== 'undefined') module.exports = create;
  else root.MdViewFileSelection = create;
})(globalThis);
