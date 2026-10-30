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
/**
 * The analyzer answers with an error code; the words a coach reads live here,
 * so Python never writes UI copy. Unknown codes fall back to a plain failure.
 */
const ANALYZER_ERRORS: Record<string, string> = {
  video_unreadable: 'Este vídeo não abre aqui. Converte para MP4 H.264.',
  video_too_large: 'O vídeo passa de 1 GB. Corta uma cópia mais curta.',
  segment_invalid: 'Escolhe um trecho até 120 s.',
  segment_beyond_video: 'O trecho passa do fim do vídeo.',
  region_invalid: 'Escolhe outra vez a área do atleta, dentro do vídeo.',
  follow_needs_region: 'Escolhe a área do atleta para a seguir.',
  transitions_invalid: 'Há transições que não batem certo. Remove-as e marca-as outra vez.',
  transition_beyond_video: 'Há uma transição depois do fim do vídeo.',
  model_missing: 'Falta o modelo de deteção. Reinstala o Stroke.',
  busy: 'Já há uma deteção a correr. Espera ou cancela-a.',
  job_not_found: 'A deteção perdeu-se. Volta a detetar.',
};
export const analyzerError = (code?: string) =>
  Error(ANALYZER_ERRORS[code ?? ''] ?? 'A deteção falhou.');
/** Reads the whole video into memory; only the analysis upload needs this. */
export async function desktopVideoFile(video: DesktopVideo) {
  // A failed read (a drive unplugged mid-copy) must not read as the analyzer being down.
  try {
    const response = await fetch(video.url);
    if (response.ok) return new File([await response.blob()], video.name);
  } catch {}
  throw Error('Não foi possível abrir o vídeo.');
}
