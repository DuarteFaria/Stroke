export const THEME_KEY = 'stroke:theme';

/* The app has two entry points — the vinext page (app/layout.tsx) and the
   desktop bundle (desktop-ui/index.html, injected by vite.desktop.config.ts) —
   and both need the theme on <html> before the first paint, so this runs as an
   inline script rather than as part of the React tree. Plain ES5 source in a
   string, kept in one place so the two entries cannot drift apart.

   With no saved choice it follows the system and keeps following it; once the
   header toggle has written one, that choice wins. */
export const themeBootstrap = `(function(){try{
var k='${THEME_KEY}',s=localStorage.getItem(k),m=matchMedia('(prefers-color-scheme: light)'),r=document.documentElement;
r.dataset.theme=s==='light'||s==='dark'?s:m.matches?'light':'dark';
m.addEventListener('change',function(e){if(!localStorage.getItem(k))r.dataset.theme=e.matches?'light':'dark'});
}catch(e){}})()`;
