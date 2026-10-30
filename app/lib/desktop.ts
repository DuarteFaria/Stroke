export type DesktopVideo = { id: string; name: string; size: number; url: string };
export type DesktopProject = { id: string; text: string };
export type DesktopUpdate = {
  state: 'downloading' | 'ready' | 'error';
  version: string;
  notes: string[];
  percent: number;
  transferred: number;
  total: number;
};
declare global {
  interface Window {
    strokeDesktop?: {
      config(): Promise<{ token: string; version: string; update: DesktopUpdate | null }>;
      openProject(): Promise<DesktopProject | null>;
      adoptProject(id: string): Promise<DesktopVideo | null>;
      openVideo(): Promise<DesktopVideo | null>;
      saveProject(text: string, name: string): Promise<boolean>;
      /** PNG bytes; optional so an older shell falls back to a download. */
      saveImage?(data: Uint8Array, name: string): Promise<boolean>;
      resetProject(): Promise<void>;
      rememberVideo(id: string): Promise<void>;
      recover(): Promise<DesktopProject | null>;
      snapshot(text: string, dirty: boolean): Promise<void>;
      dirty(value: boolean): void;
      theme(value: 'light' | 'dark'): void;
      installUpdate(): Promise<void>;
      retryUpdate(): Promise<void>;
      onUpdate(fn: (update: DesktopUpdate | null) => void): () => void;
      onFlush(fn: () => void): () => void;
    };
  }
}
export const desktop = () => typeof window !== 'undefined' ? window.strokeDesktop : undefined;
export async function analyzerFetch(route: string, options: RequestInit = {}) {
  const bridge = desktop();
  if (!bridge) return fetch(`http://127.0.0.1:8766${route}`, options);
  const config = await bridge.config();
  const headers = new Headers(options.headers);
  headers.set('X-Stroke-Token', config.token);
  return fetch(`/api${route}`, { ...options, headers });
}
/** Reads the whole video into memory; only the analysis upload needs this. */
export async function desktopVideoFile(video: DesktopVideo) {
  const response = await fetch(video.url);
  if (!response.ok) throw Error('Não foi possível abrir o vídeo.');
  return new File([await response.blob()], video.name);
}
