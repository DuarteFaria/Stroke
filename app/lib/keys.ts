/**
 * Teclas que não são do editor: as que outro já tratou, as escritas num campo e
 * as que caem numa janela ou num menu aberto. Vale para todas, Esc incluído.
 */
export function editorKeysBlocked(e: KeyboardEvent) {
  const el = e.target as HTMLElement;
  return (
    e.defaultPrevented ||
    el.isContentEditable ||
    !!el.closest(
      'input,textarea,select,[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="combobox"][aria-expanded="true"]',
    )
  );
}
