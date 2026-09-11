'use client';
import { useSyncExternalStore } from 'react';
import { Sun, Moon } from 'lucide-react';
import { THEME_KEY } from './theme';
import { desktop } from '@/lib/desktop';

/* The live theme is the `data-theme` attribute the layout script stamps on
   <html> — an external store, not React state. Reading it that way also keeps
   the icon right when the attribute changes without us: the same script flips
   it when the system switches and no choice has been saved. */
const subscribe = (onChange: () => void) => {
  const watcher = new MutationObserver(onChange);
  watcher.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => watcher.disconnect();
};
const current = () =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
const onServer = () => 'dark' as const;

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, onServer);
  const label = theme === 'light' ? 'Tema escuro' : 'Tema claro';
  const flip = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    // The Electron shell paints the window background and the splash screen
    // before this page exists, so it has to be told separately.
    desktop()?.theme?.(next);
  };
  return (
    <button
      className="theme-toggle"
      onClick={flip}
      title={label}
      aria-label={label}
    >
      {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
