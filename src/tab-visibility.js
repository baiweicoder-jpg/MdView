/* Reveal only a changed active identity; never focus or scroll ancestors. */
(() => {
  const bar = document.querySelector('#tab-bar');
  let activeId;
  function sync() {
    const id = bar.querySelector('.tab.active')?.dataset.id;
    if (id === activeId) return;
    activeId = id;
    requestAnimationFrame(() => {
      const tab = bar.querySelector('.tab.active');
      if (!tab || tab.dataset.id !== id) return;
      const bounds = tab.getBoundingClientRect();
      const left = bar.getBoundingClientRect().left + bar.clientLeft;
      const right = left + bar.clientWidth;
      if (bounds.left < left) bar.scrollLeft += bounds.left - left;
      else if (bounds.right > right) bar.scrollLeft += Math.min(bounds.right - right, bounds.left - left);
    });
  }
  new MutationObserver(sync).observe(bar, {childList:true, subtree:true, attributes:true, attributeFilter:['class']});
  sync();
})();
