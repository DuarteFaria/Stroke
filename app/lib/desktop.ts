export type DesktopVideo = { id: string; name: string; size: number; url: string };
export type DesktopProject = { id: string; text: string };
declare global {
  interface Window {
    strokeDesktop?: {
      config(): Promise<{ api: string; token: string; version: string }>;
      openProject(): Promise<DesktopProject | null>;
      adoptProject(id: string): Promise<DesktopVideo | null>;
      openVideo(): Promise<DesktopVideo | null>;
      saveProject(text: string, name: string): Promise<boolean>;
      resetProject(): Promise<void>;
      rememberVideo(id: string): Promise<void>;
      recover(): Promise<DesktopProject | null>;
      snapshot(text: string, dirty: boolean): Promise<void>;
      dirty(value: boolean): void;
      theme(value: 'light' | 'dark'): void;
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
  return fetch(`${config.api}${route}`, { ...options, headers });
}
export async function desktopVideoFile(video: DesktopVideo) {
  const config = await desktop()!.config();
  const response = await fetch(video.url, { headers: { 'X-Stroke-Token': config.token } });
  if (!response.ok) throw Error('Não foi possível abrir o vídeo.');
  return new File([await response.blob()], video.name);
}
