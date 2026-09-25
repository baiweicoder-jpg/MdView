// Small local line-icon set. No network or icon-font dependency.
(() => {
  const icons = {
    'file-plus': '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 12v6M9 15h6"/>',
    folder: '<path d="M3 8V5h6l2 3h10v3M3 8h7l2 3h9l-3 9H3z"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/>',
    'save-as': '<path d="M10 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v4M7 3v6h9V3M7 21v-8h5M14 20l1-4 5-5 3 3-5 5z"/>',
    edit: '<path d="m14 5 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    refresh: '<path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5"/>',
    settings: '<path d="m9 3-1 3-3 1-2 4 2 2v4l4 3 3-1 3 1 4-3v-4l2-2-2-4-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
    sliders: '<path d="M4 7h8m4 0h4M4 17h3m4 0h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m-7-11 3 3-3 3"/>',
    outline: '<path d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01"/>',
    bold: '<path d="M6 12h8a4 4 0 0 0 0-8H6v16h9a4 4 0 0 0 0-8"/>',
    italic: '<path d="M10 4h10M4 20h10M15 4 9 20"/>',
    list: '<path d="M9 5h11M9 12h11M9 19h11"/><circle cx="4" cy="5" r=".6"/><circle cx="4" cy="12" r=".6"/><circle cx="4" cy="19" r=".6"/>',
    'list-ordered': '<path d="M10 5h10M10 12h10M10 19h10M3 3h1v5M3 8h2M2 14c0-3 4-3 4-1 0 1-3 3-4 5h4"/>',
    quote: '<path d="M4 5h6v7H4zM14 5h6v7h-6zM10 12c0 4-2 6-5 7M20 12c0 4-2 6-5 7"/>',
    code: '<path d="m7 6-6 6 6 6m10-12 6 6-6 6M14 3l-4 18"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    'row-plus': '<rect x="3" y="3" width="18" height="10" rx="2"/><path d="M3 8h18M9 3v10M12 16v6M9 19h6"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    undo: '<path d="M3 5v6h6M3 11c5-9 18-6 18 3 0 3-2 6-5 7"/>',
    redo: '<path d="M21 5v6h-6M21 11C16 2 3 5 3 14c0 3 2 6 5 7"/>',
  };
  for (const element of document.querySelectorAll('[data-icon]')) {
    const drawing = icons[element.dataset.icon];
    if (drawing) element.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawing}</svg>`;
  }
})();
