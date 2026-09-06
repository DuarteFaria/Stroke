'use client';
import { desktop, analyzerFetch, desktopVideoFile, type DesktopProject } from '@/lib/desktop';
import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useEffectEvent,
  useLayoutEffect,
} from 'react';
import {
  Upload,
  Download,
  FolderOpen,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Undo2,
  Redo2,
  ScanLine,
  Plus,
  X,
  Flag,
  MousePointer2,
  Info,
  CircleCheck,
  TriangleAlert,
  LoaderCircle,
  Check,
  Keyboard,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  JOINTS,
  BONES,
  clamp,
  poseAt,
  motionFlags,
  cautiousLegs,
  regionAt,
  keyAt,
  applyOffsets,
  upsert,
  editCorrection,
  angle,
  paddleAngle,
  emptyProject,
  parseProject,
  type Project,
  type Point,
  type Frame,
  type Region,
} from '@/lib/motion';
type AnalysisResult = {
  fps: number;
  start: number;
  end: number;
  frames: Frame[];
  detected: number;
  total: number;
  sampleFps: number;
};
type JobResponse = {
  id: string;
  detail?: string;
  status: string;
  progress: number;
  error?: string;
  result: AnalysisResult;
};
type Tone = 'info' | 'ok' | 'warn' | 'busy';
type Confirm = {
  run: () => void;
  title: string;
  body: string;
  action: string;
  offerSave: boolean;
  /** True when the action throws work away for good, so it reads as a warning
      and never sits in the rightmost "default" slot. */
  danger: boolean;
};
/**
 * Every limb gets its own colour on the corrected skeleton, because crossing
 * arms are exactly where the tracker goes wrong and one flat colour hides it.
 * The proposed movement stays a single orange so it never melts into the body.
 */
const LIMB = {
  torso: '#f2ede0',
  armL: '#4ee08a',
  armR: '#3fc8ff',
  legL: '#b98cff',
  legR: '#f45bd0',
};
type LimbName = keyof typeof LIMB;
const BONE_LIMB: Record<string, LimbName> = {
  '11-12': 'torso',
  '11-23': 'torso',
  '12-24': 'torso',
  '23-24': 'torso',
  '11-13': 'armL',
  '13-15': 'armL',
  '12-14': 'armR',
  '14-16': 'armR',
  '23-25': 'legL',
  '25-27': 'legL',
  '24-26': 'legR',
  '26-28': 'legR',
};
const JOINT_LIMB: Record<number, LimbName> = {
  0: 'torso',
  11: 'armL',
  13: 'armL',
  15: 'armL',
  12: 'armR',
  14: 'armR',
  16: 'armR',
  23: 'legL',
  25: 'legL',
  27: 'legL',
  24: 'legR',
  26: 'legR',
  28: 'legR',
};
const INK = {
  target: '#ff9d4d',
  paddle: '#ffd84d',
  before: '#9c978c',
  hollow: '#0b0b09',
  ring: '#0b0b09',
};
const PADDLE_POINTS: [string, string][] = [
  ['a', 'Pá A'],
  ['b', 'Pá B'],
  ['r1', 'Referência 1'],
  ['r2', 'Referência 2'],
];
const SIDES: [string, string][] = [
  ['Left', 'Pá esquerda'],
  ['Right', 'Pá direita'],
];
const SIDE_WORD: Record<string, string> = {
  Left: 'pá esquerda',
  Right: 'pá direita',
};
const KIND_WORD: Record<string, string> = { Catch: 'Ataque', Exit: 'Saída' };
/** Os três botões escolhem o que se arrasta por cima do vídeo. */
const MODES: Record<string, { label: string; hud: string }> = {
  correct: { label: 'Corpo', hud: 'Arrasta os pontos' },
  paddle: { label: 'Pagaia', hud: 'Carrega para pôr um ponto' },
  target: { label: 'Ideal', hud: 'Arrasta o esqueleto laranja' },
};
const fmt = (t: number) =>
  `${Math.floor(t / 60)
    .toString()
    .padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const deg = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}°`);
const pointName = (id: string) =>
  PADDLE_POINTS.find((x) => x[0] === id.replace(/^p:/, ''))?.[1] ||
  JOINTS[Number(id)] ||
  id;
const sure = (v: number) => (v < 0.5 ? 'incerto' : 'revisto');
/** Nome de ficheiro seguro que não come os acentos do nome do projeto. */
const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/gi, '_');
function Choice({
  value,
  onChange,
  items,
  label,
}: {
  value: string;
  onChange: (x: string) => void;
  items: [string, string][];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
      <SelectTrigger aria-label={label}>
        <SelectValue>{items.find((i) => i[0] === value)?.[1]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Toggle({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (x: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="toggle" data-disabled={disabled || undefined}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      {children}
    </label>
  );
}
export default function Studio() {
  const [p, setP] = useState<Project>(emptyProject),
    [src, setVideoSrc] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState('0.5'),
    [loop, setLoop] = useState(true);
  const [mode, setMode] = useState('correct'),
    [showRaw, setShowRaw] = useState(false),
    [showTarget, setShowTarget] = useState(true),
    [showPaths, setShowPaths] = useState(false),
    [selected, setSelected] = useState('15'),
    [side, setSide] = useState('Left'),
    [placing, setPlacing] = useState<string | null>(null),
    [note, setNote] = useState<{ text: string; tone: Tone }>({
      text: '',
      tone: 'info',
    }),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [job, setJob] = useState(''),
    [connected, setConnected] = useState(true),
    [confirm, setConfirm] = useState<Confirm | null>(null),
    [confirmOpen, setConfirmOpen] = useState(false),
    [undoCount, setUndoCount] = useState(0),
    [redoCount, setRedoCount] = useState(0),
    [dirty, setDirty] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    history = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    current = useRef(p),
    timeRef = useRef(time),
    drag = useRef<{ id: string; before: Project } | null>(null),
    scrubBefore = useRef<Project | null>(null),
    noteSeq = useRef(0),
    cancelled = useRef(false),
    dirtyRef = useRef(false);
  const [relinking, setRelinking] = useState(false);
  const [selectingRegion, setSelectingRegion] = useState(false);
  const [regionDraft, setRegionDraft] = useState<Region | null>(null);
  const [transitionStart, setTransitionStart] = useState<number | null>(null);
  const regionStart = useRef<Point | null>(null);
  function setSrc(value: string) {
    setTransitionStart(null);
    setVideoSrc(value);
    setSelectingRegion(false);
    setRegionDraft(null);
    regionStart.current = null;
  }
  const [desktopReady, setDesktopReady] = useState(false);
  useLayoutEffect(() => {
    current.current = p;
    timeRef.current = time;
    dirtyRef.current = dirty;
  }, [p, time, dirty]);
  /**
   * Confirmações desaparecem sozinhas; só um problema ou um trabalho a correr
   * é que fica no ecrã à espera de quem o leia.
   */
  function say(text: string, tone: Tone = 'info') {
    const id = ++noteSeq.current;
    setNote({ text, tone });
    const life = tone === 'ok' ? 5000 : tone === 'info' ? 9000 : 0;
    if (life)
      setTimeout(() => {
        if (noteSeq.current === id) setNote({ text: '', tone: 'info' });
      }, life);
  }
  function hush() {
    noteSeq.current++;
    setNote({ text: '', tone: 'info' });
  }
  const saveHistory = (before: Project) => {
    history.current = [...history.current.slice(-29), before];
    future.current = [];
    setUndoCount(history.current.length);
    setRedoCount(0);
    setDirty(true);
  };
  const commit = (next: Project) => {
    saveHistory(current.current);
    setP(next);
  };
  function seek(t: number) {
    const v = video.current;
    if (v && src && !busy) {
      v.pause();
      v.currentTime = clamp(
        t,
        0,
        Math.max(0, p.video.duration - 1 / p.video.fps),
      );
      setTime(v.currentTime);
    }
  }
  function undo() {
    const prev = history.current.pop();
    if (prev) {
      future.current.push(current.current);
      setP(prev);
      setDirty(true);
    }
    setUndoCount(history.current.length);
    setRedoCount(future.current.length);
  }
  function redo() {
    const next = future.current.pop();
    if (next) {
      history.current.push(current.current);
      setP(next);
      setDirty(true);
    }
    setUndoCount(history.current.length);
    setRedoCount(future.current.length);
  }
  function checkHealth() {
    void analyzerFetch('/health')
      .then((r) => r.json() as Promise<{ ok: boolean; modelReady: boolean }>)
      .then((x) => setConnected(x.ok && x.modelReady))
      .catch(() => setConnected(false));
  }
  async function exportProject() {
    const x = current.current;
    if (desktop()) {
      try {
        if (!await desktop()!.saveProject(JSON.stringify(x, null, 2), slug(x.name))) return false;
        if (current.current === x) setDirty(false);
        say('Projeto guardado.', 'ok');
        return true;
      } catch (e) {
        say(e instanceof Error ? e.message : 'Não foi possível guardar.', 'warn');
        return false;
      }
    }
    const blob = new Blob([JSON.stringify(x, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `${slug(x.name) || 'stroke'}.stroke.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDirty(false);
    say('Projeto guardado. Guarda o vídeo original ao lado.', 'ok');
    return true;
  }
  async function pickVideo() {
    if (!desktop()) { fileInput.current?.click(); return; }
    try {
      const selected = await desktop()!.openVideo();
      if (!selected) return;
      const f = await desktopVideoFile(selected);
      if (newVideo(f)) {
        if (!relinking) await desktop()!.resetProject();
        await desktop()!.rememberVideo(selected.id);
      }
    } catch (e) { say(e instanceof Error ? e.message : 'Não foi possível abrir o vídeo.', 'warn'); }
  }
  async function importProject(f: File) {
    try {
      if (f.size > 30 * 1024 ** 2) throw Error('Projeto com mais de 30 MB.');
      const loaded = parseProject(JSON.parse(await f.text()));
      video.current?.pause();
      setP(loaded);
      setFile(null);
      setSrc('');
      setTime(loaded.segment[0]);
      setRelinking(true);
      history.current = [];
      future.current = [];
      setUndoCount(0);
      setRedoCount(0);
      setDirty(false);
      setMode('correct');
      say(`Projeto aberto. Escolhe o ficheiro ${loaded.video.name}.`, 'info');
      return loaded;
    } catch (e) {
      say(e instanceof Error ? e.message : 'Não é um projeto Stroke.', 'warn');
    }
  }
  async function loadDesktopProject(entry: DesktopProject, recovered = false) {
    const loaded = await importProject(new File([entry.text], 'project.stroke.json'));
    if (!loaded) return;
    const selected = await desktop()!.adoptProject(entry.id);
    if (selected && selected.name === loaded.video.name && selected.size === loaded.video.size) {
      try {
        const f = await desktopVideoFile(selected);
        setFile(f); setSrc(URL.createObjectURL(f));
      } catch { say('Projeto aberto. Escolhe novamente o vídeo original.', 'warn'); }
    }
    if (recovered) { setDirty(true); say('Trabalho recuperado. Guarda o projeto para conservar as alterações.', 'ok'); }
  }
  async function pickProject() {
    if (!desktop()) { projectInput.current?.click(); return; }
    try {
      const entry = await desktop()!.openProject();
      if (entry) await loadDesktopProject(entry);
    } catch (e) { say(e instanceof Error ? e.message : 'Não foi possível abrir o projeto.', 'warn'); }
  }
  function askConfirm(c: Confirm) {
    setConfirm(c);
    setConfirmOpen(true);
  }
  function ask(action: () => void, title: string, body: string, label: string) {
    if (dirty)
      askConfirm({
        run: action,
        title,
        body,
        action: label,
        offerSave: true,
        danger: true,
      });
    else action();
  }
  function openVideo() {
    if (relinking) {
      void pickVideo();
      return;
    }
    ask(
      () => void pickVideo(),
      'Abrir outro vídeo?',
      'Tens edições por guardar. Abrir outro vídeo começa um projeto novo.',
      'Descartar e abrir',
    );
  }
  function openProject() {
    ask(
      () => void pickProject(),
      'Abrir outro projeto?',
      'Tens edições por guardar. Abrir um projeto substitui tudo o que está no ecrã.',
      'Descartar e abrir',
    );
  }
  function newVideo(f: File) {
    if (f.size > 1024 ** 3) {
      say(
        `Ficheiro com ${(f.size / 1024 ** 3).toFixed(1)} GB. O limite é 1 GB.`,
        'warn',
      );
      return false;
    }
    if (relinking && (f.name !== p.video.name || f.size !== p.video.size)) {
      say(`Este projeto precisa do ficheiro ${p.video.name}.`, 'warn');
      return false;
    }
    video.current?.pause();
    setSrc(URL.createObjectURL(f));
    setFile(f);
    setTime(0);
    setPlacing(null);
    if (!relinking) {
      setP({
        ...emptyProject(),
        name: f.name.replace(/\.[^.]+$/, ''),
        video: { ...emptyProject().video, name: f.name, size: f.size },
      });
      history.current = [];
      future.current = [];
      setUndoCount(0);
      setRedoCount(0);
      setDirty(false);
      setMode('correct');
      say('Escolhe o trecho na barra e deteta o atleta.', 'ok');
    }
    return true;
  }
  function togglePlay() {
    const v = video.current;
    if (!v || !src || busy) return;
    if (v.paused) {
      if (v.currentTime < p.segment[0] || v.currentTime >= p.segment[1])
        v.currentTime = p.segment[0];
      v.play().catch(() =>
        say('Este vídeo não abre aqui. Converte para MP4 H.264.', 'warn'),
      );
    } else v.pause();
  }
  useEffect(
    () => () => {
      if (src) URL.revokeObjectURL(src);
    },
    [src],
  );
  useEffect(() => {
    checkHealth();
    window.addEventListener('focus', checkHealth);
    return () => window.removeEventListener('focus', checkHealth);
  }, []);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current && !desktop()) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, []);
  useEffect(() => {
    if (!desktop()) return;
    void desktop()!.recover().then(async entry => {
      if (entry) await loadDesktopProject(entry, true);
    }).catch(e => say(`Não foi possível recuperar: ${String(e)}`, 'warn'))
      .finally(() => setDesktopReady(true));
  }, []);
  useEffect(() => {
    if (!desktop() || !desktopReady) return;
    desktop()!.dirty(dirty);
    if (p.video.name) void desktop()!.snapshot(JSON.stringify(p), dirty)
      .catch(() => say('Não foi possível criar a cópia de recuperação. Guarda o projeto.', 'warn'));
  }, [p, dirty, desktopReady]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = Number(speed);
  }, [speed, src]);
  useEffect(() => {
    let handle = 0;
    const tick = () => {
      const v = video.current;
      if (v && !v.paused) {
        const [a, b] = current.current.segment;
        if (v.currentTime >= b) {
          if (loop) {
            v.currentTime = a;
          } else {
            v.pause();
            v.currentTime = b;
          }
        }
        setTime(v.currentTime);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [loop]);
  const keyboardEvent = useEffectEvent((e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (current.current.video.duration && !busy) void exportProject();
      return;
    }
    if (e.key === 'Escape') {
      setPlacing(null);
      hush();
      return;
    }
    if (busy || el.closest('input,textarea,[contenteditable="true"]')) return;
    if (mod && e.key === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Z')) {
      e.preventDefault();
      redo();
      return;
    }
    if (
      el.closest(
        'button,summary,[role="combobox"],[role="slider"],[role="dialog"]',
      )
    )
      return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      seek(timeRef.current + 1 / current.current.video.fps);
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(timeRef.current - 1 / current.current.video.fps);
    }
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => keyboardEvent(event);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    const doc = document as Document & {
      modelContext?: {
        registerTool: (
          tool: unknown,
          options: { signal: AbortSignal },
        ) => unknown;
      };
    };
    if (!doc.modelContext) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        doc.modelContext.registerTool(
          {
            name: 'get_stroke_session',
            description:
              'Read the current video segment, playback time and annotation counts.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: () => {
              const x = current.current;
              return {
                name: x.name,
                video: x.video.name,
                segment: x.segment,
                time: timeRef.current,
                trackedFrames: x.frames.length,
                corrections: x.corrections.length,
                targetKeys: x.target.length,
                events: x.events,
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  function metadata() {
    const v = video.current;
    if (!v) return;
    if (relinking) {
      if (
        Math.abs(v.duration - p.video.duration) > 0.2 ||
        v.videoWidth !== p.video.width ||
        v.videoHeight !== p.video.height
      ) {
        setSrc('');
        setFile(null);
        say('Tamanho ou duração diferentes do vídeo original.', 'warn');
        return;
      }
      setRelinking(false);
      v.currentTime = p.segment[0];
      setTime(p.segment[0]);
      say('Vídeo ligado. Edições recuperadas.', 'ok');
      return;
    }
    setP((x) => ({
      ...x,
      video: {
        ...x.video,
        duration: v.duration,
        width: v.videoWidth,
        height: v.videoHeight,
      },
      segment: [0, Math.min(20, v.duration)],
    }));
  }
  async function analyze() {
    if (!file || busy || selectingRegion) return;
    video.current?.pause();
    setBusy(true);
    setProgress(0);
    cancelled.current = false;
    say('A enviar o vídeo…', 'busy');
    let id = '';
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('start', String(p.segment[0]));
      form.append('end', String(p.segment[1]));
      form.append('quality', p.analysisQuality || 'standard');
      form.append('transitions', JSON.stringify(p.transitions || []));
      if (p.athleteRegion) form.append('region', JSON.stringify(p.athleteRegion));
      if (p.athleteRegion && p.followAthlete) form.append('follow', 'true');
      const response = await analyzerFetch('/analyze', {
        method: 'POST',
        body: form,
      });
      const data = (await response.json()) as JobResponse;
      if (!response.ok) throw Error(data.detail || 'A análise falhou.');
      id = data.id;
      setJob(id);
      setConnected(true);
      say('À procura do atleta…', 'busy');
      while (true) {
        if (cancelled.current)
          await analyzerFetch(`/jobs/${id}`, { method: 'DELETE' });
        const response = await analyzerFetch(`/jobs/${id}`);
        if (!response.ok) throw Error('Não deu para ler o estado da análise.');
        const data = (await response.json()) as JobResponse;
        setProgress(data.progress);
        if (data.status === 'error') throw Error(data.error);
        if (data.status === 'cancelled') {
          say('Análise cancelada.', 'info');
          break;
        }
        if (data.status === 'done') {
          if (cancelled.current) {
            say('Análise cancelada.', 'info');
            break;
          }
          const r = data.result;
          const old = current.current;
          commit({
            ...old,
            video: { ...old.video, fps: r.fps },
            frames: [
              ...old.frames.filter((f) => f.t < r.start || f.t > r.end),
              ...r.frames,
            ].sort((a, b) => a.t - b.t),
            corrections: old.corrections.filter(
              (k) => k.t < r.start || k.t > r.end,
            ),
            target: old.target.filter((k) => k.t < r.start || k.t > r.end),
          });
          seek(r.start);
          say(
            `Atleta encontrado em ${r.detected}/${r.total} fotogramas. Tracejado = rever.`,
            r.detected > r.total * 0.6 ? 'ok' : 'warn',
          );
          break;
        }
        await new Promise((r) => setTimeout(r, 650));
      }
    } catch (e) {
      checkHealth();
      say(
        e instanceof Error
          ? e.message
          : 'Analisador não responde. Arranca com o Start-Stroke.ps1.',
        'warn',
      );
    } finally {
      setBusy(false);
      setJob('');
    }
  }
  function startTracking() {
    if (p.corrections.length || p.target.length)
      askConfirm({
        run: () => void analyze(),
        title: 'Detetar outra vez?',
        body: 'Perdes as correções feitas dentro deste trecho. Podes anular a seguir.',
        action: 'Detetar',
        offerSave: false,
        danger: false,
      });
    else void analyze();
  }
  const inSegment =
    time >= p.segment[0] - 0.001 && time <= p.segment[1] + 0.001;
  const reviewFlags = useMemo(() => motionFlags(p.frames, p.video.width, p.video.height),
    [p.frames,p.video.width,p.video.height]);
  const followedFrame = !selectingRegion && p.followAthlete && p.athleteRegion && inSegment
    ? regionAt(p.frames, time) : undefined;
  /**
   * Uma colocação a meio não faz sentido fora do trecho nem durante a análise,
   * por isso deixa de aparecer sozinha em vez de ficar presa no ecrã.
   */
  const placingNow = placing && !busy && inSegment ? placing : null;
  const raw = useMemo(
    () => (inSegment ? poseAt(p.frames, time) : null),
    [p.frames, time, inSegment],
  );
  const corrected = useMemo(
    () => applyOffsets(raw, p.corrections, time),
    [raw, p.corrections, time],
  );
  const target = useMemo(
    () => applyOffsets(corrected, p.target, time),
    [corrected, p.target, time],
  );
  const reviewedPose = cautiousLegs(corrected, reviewFlags, time);
  const reviewedTarget = cautiousLegs(target, reviewFlags, time);
  const paddle = useMemo(() => keyAt(p.paddle, time, false), [p.paddle, time]);
  const targetPaddle = useMemo(() => {
    const delta = keyAt(p.targetPaddle, time);
    return Object.fromEntries(
      Object.entries(paddle).map(([id, pt]) => [
        id,
        delta[id]
          ? { ...pt, x: pt.x + delta[id].x, y: pt.y + delta[id].y }
          : pt,
      ]),
    );
  }, [paddle, p.targetPaddle, time]);
  const editable = mode === 'target' ? target : corrected;
  const selectedPoint = editable?.[Number(selected)];
  const w = p.video.width,
    h = p.video.height;
  const tracked = p.frames.length > 0;
  const duration = Math.max(0.01, p.video.duration);
  const segmentLength = p.segment[1] - p.segment[0];
  const pct = (t: number) => (clamp(t, 0, duration) / duration) * 100;
  const bands = useMemo(() => {
    const out: [number, number][] = [];
    for (const f of p.frames) {
      if (!f.points) continue;
      const last = out[out.length - 1];
      if (last && f.t - last[1] <= 0.25) last[1] = f.t;
      else out.push([f.t, f.t]);
    }
    return out;
  }, [p.frames]);
  const videoAction = relinking
    ? 'Escolher o original'
    : src
      ? 'Trocar vídeo'
      : 'Escolher vídeo';
  const blocked = !src
    ? 'Abre primeiro um vídeo.'
    : !file
      ? 'Liga primeiro o vídeo original.'
      : busy
        ? 'Já está a analisar.'
        : segmentLength > 120
          ? `Trecho de ${segmentLength.toFixed(0)} s. O máximo é 120 s.`
          : '';
  function pointFromEvent(e: React.PointerEvent<SVGSVGElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width),
      y: clamp((e.clientY - r.top) / r.height),
      v: 1,
    };
  }
  function updatePoint(id: string, pt: Point, before: Project) {
    const t = timeRef.current;
    if (mode === 'paddle') {
      return { ...before, paddle: upsert(before.paddle, t, id, pt) };
    }
    if (mode === 'target' && id.startsWith('p:')) {
      const key = id.slice(2),
        base = keyAt(before.paddle, t, false)[key];
      if (!base) return before;
      return {
        ...before,
        targetPaddle: upsert(before.targetPaddle, t, key, {
          x: pt.x - base.x,
          y: pt.y - base.y,
          v: 1,
        }),
      };
    }
    const base =
      mode === 'target'
        ? applyOffsets(poseAt(before.frames, t), before.corrections, t)
        : poseAt(before.frames, t);
    if (!base) return before;
    const offset = {
      x: pt.x - base[Number(id)].x,
      y: pt.y - base[Number(id)].y,
      v: 1,
    };
    return mode === 'target'
      ? { ...before, target: upsert(before.target, t, id, offset) }
      : {
          ...before,
          corrections: editCorrection(
            before.corrections,
            t,
            id,
            offset,
            before.segment,
          ),
        };
  }
  function down(e: React.PointerEvent<SVGSVGElement>) {
    if (busy || !src || !inSegment) return;
    video.current?.pause();
    const pt = pointFromEvent(e);
    if (selectingRegion) {
      regionStart.current = pt;
      setRegionDraft(null);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (placingNow) {
      commit(updatePoint(placingNow, pt, current.current));
      say(`${pointName(placingNow)} colocado.`, 'ok');
      setPlacing(null);
      return;
    }
    const id = (e.target as SVGElement).getAttribute('data-point');
    if (!id) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, before: current.current };
    if (!id.startsWith('p:') && JOINTS[Number(id)]) setSelected(id);
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    if (regionStart.current) {
      const a = regionStart.current, b = pointFromEvent(e);
      setRegionDraft({x: Math.min(a.x,b.x), y: Math.min(a.y,b.y),
        width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y)});
      return;
    }
    if (drag.current)
      setP(
        updatePoint(drag.current.id, pointFromEvent(e), drag.current.before),
      );
  }
  function up(e: React.PointerEvent<SVGSVGElement>) {
    if (regionStart.current) {
      const a = regionStart.current, b = pointFromEvent(e);
      const region = {x: Math.min(a.x,b.x), y: Math.min(a.y,b.y),
        width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y)};
      regionStart.current = null;
      setRegionDraft(null);
      if (region.width >= 0.05 && region.height >= 0.05) {
        commit({...current.current, athleteRegion: region});
        setSelectingRegion(false);
        say('Área guardada. Revê o trecho e volta a detetar para aplicar.', 'info');
      } else say('Desenha uma área maior, com espaço para os braços.', 'warn');
      return;
    }
    if (drag.current) {
      saveHistory(drag.current.before);
      drag.current = null;
    }
  }
  function nudge(dx: number, dy: number) {
    if (!selectedPoint || busy) return;
    video.current?.pause();
    commit(
      updatePoint(
        selected,
        {
          ...selectedPoint,
          x: clamp(selectedPoint.x + dx / w),
          y: clamp(selectedPoint.y + dy / h),
        },
        current.current,
      ),
    );
  }
  function mark(kind: 'Catch' | 'Exit') {
    commit({
      ...p,
      events: [
        ...p.events,
        {
          id: crypto.randomUUID(),
          t: time,
          kind,
          side: side as 'Left' | 'Right',
        },
      ].sort((a, b) => a.t - b.t),
    });
    say(`${KIND_WORD[kind]} · ${SIDE_WORD[side]}.`, 'ok');
  }
  function setSegment(edge: 'in' | 'out', t: number, keep: Project): Project {
    return {
      ...keep,
      segment: (edge === 'in'
        ? [clamp(t, 0, keep.segment[1] - 0.1), keep.segment[1]]
        : [keep.segment[0], clamp(t, keep.segment[0] + 0.1, duration)]) as [
        number,
        number,
      ],
    };
  }
  /** Um gesto inteiro no marcador vale um único passo de anular. */
  function dragSegment(edge: 'in' | 'out', value: number) {
    if (!scrubBefore.current) scrubBefore.current = current.current;
    setP((x) => setSegment(edge, value, x));
  }
  function endSegmentEdit() {
    const before = scrubBefore.current;
    scrubBefore.current = null;
    if (!before) return;
    const now = current.current.segment;
    if (before.segment[0] !== now[0] || before.segment[1] !== now[1])
      saveHistory(before);
  }
  function selectMode(next: string) {
    setMode(next);
    setPlacing(null);
    if (next === 'target') setShowTarget(true);
  }
  const metrics = [
    [
      'Cotovelo esq.',
      angle(corrected?.[11], corrected?.[13], corrected?.[15], w, h),
      angle(target?.[11], target?.[13], target?.[15], w, h),
    ],
    [
      'Cotovelo dir.',
      angle(corrected?.[12], corrected?.[14], corrected?.[16], w, h),
      angle(target?.[12], target?.[14], target?.[16], w, h),
    ],
    [
      'Joelho esq.',
      angle(reviewedPose?.[23], reviewedPose?.[25], reviewedPose?.[27], w, h),
      angle(reviewedTarget?.[23], reviewedTarget?.[25], reviewedTarget?.[27], w, h),
    ],
    [
      'Joelho dir.',
      angle(reviewedPose?.[24], reviewedPose?.[26], reviewedPose?.[28], w, h),
      angle(reviewedTarget?.[24], reviewedTarget?.[26], reviewedTarget?.[28], w, h),
    ],
    [
      'Pá / referência',
      paddleAngle(paddle, w, h),
      paddleAngle(targetPaddle, w, h),
    ],
  ] as [string, number | null, number | null][];
  /** O rasto de cada pulso leva a cor do braço a que pertence. */
  const paths = useMemo(() => {
    if (!showPaths) return [];
    return [15, 16].flatMap((id) => {
      const chunks: string[] = [''];
      for (const f of p.frames) {
        if (
          f.t < Math.max(p.segment[0], time - 1.5) ||
          f.t > Math.min(time, p.segment[1])
        )
          continue;
        const pt = applyOffsets(f.points, p.corrections, f.t)?.[id];
        if (!pt || pt.v < 0.5) {
          if (chunks[chunks.length - 1]) chunks.push('');
          continue;
        }
        chunks[chunks.length - 1] += `${pt.x * w},${pt.y * h} `;
      }
      return chunks
        .filter(Boolean)
        .map((points) => ({ points, ink: LIMB[JOINT_LIMB[id]] }));
    });
  }, [showPaths, p.frames, p.corrections, time, p.segment, w, h]);
  const keys =
    mode === 'correct'
      ? p.corrections
      : mode === 'target'
        ? p.target
        : p.paddle;
  const keysHere = keys.filter(
    (k) => k.t >= p.segment[0] && k.t <= p.segment[1],
  );
  const paddleKeyHere = p.paddle.some((k) => Math.abs(k.t - time) < 0.04);
  const canEdit = !!selectedPoint && !busy && !!src;
  /** `tint` a null pinta cada membro da sua cor; senão a camada é toda igual. */
  function skeleton(
    points: Point[] | null,
    tint: string | null,
    interactive: boolean,
    dashed = false,
  ) {
    if (!points) return null;
    return (
      <g
        pointerEvents={interactive ? undefined : 'none'}
        opacity={dashed ? 0.45 : 1}
      >
        {BONES.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={points[a].x * w}
            y1={points[a].y * h}
            x2={points[b].x * w}
            y2={points[b].y * h}
            stroke={tint ?? LIMB[BONE_LIMB[`${a}-${b}`]]}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeDasharray={
              dashed || Math.min(points[a].v, points[b].v) < 0.5
                ? '5 5'
                : undefined
            }
          />
        ))}
        {Object.keys(JOINTS).map((id) => {
          const pt = points[Number(id)];
          const ink = tint ?? LIMB[JOINT_LIMB[Number(id)]];
          const picked = selected === id && interactive;
          return (
            <circle
              key={id}
              data-point={interactive ? id : undefined}
              cx={pt.x * w}
              cy={pt.y * h}
              r={w * (picked ? 0.011 : 0.007)}
              fill={pt.v < 0.5 ? INK.hollow : ink}
              stroke={picked ? INK.ring : ink}
              strokeWidth={picked ? 3 : 1.5}
              vectorEffect="non-scaling-stroke"
              className={interactive ? 'handle' : ''}
            >
              <title>
                {JOINTS[Number(id)]} · {sure(pt.v)}
              </title>
            </circle>
          );
        })}
      </g>
    );
  }
  function paddleDrawing(
    pts: Record<string, Point>,
    color: string,
    targetLayer = false,
  ) {
    return (
      <g
        pointerEvents={
          (mode === 'paddle' && !targetLayer) ||
          (mode === 'target' && targetLayer)
            ? undefined
            : 'none'
        }
        stroke={color}
        fill={color}
      >
        {[
          ['a', 'b'],
          ['r1', 'r2'],
        ].map(([a, b]) =>
          pts[a] && pts[b] ? (
            <line
              key={a}
              x1={pts[a].x * w}
              y1={pts[a].y * h}
              x2={pts[b].x * w}
              y2={pts[b].y * h}
              strokeWidth={a === 'a' ? 3 : 1.5}
              strokeDasharray={a === 'r1' ? '6 4' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}
        {Object.entries(pts).map(([id, pt]) => (
          <circle
            key={id}
            data-point={
              mode === 'paddle' && !targetLayer
                ? id
                : mode === 'target' && targetLayer
                  ? `p:${id}`
                  : undefined
            }
            cx={pt.x * w}
            cy={pt.y * h}
            r={w * 0.008}
            stroke={INK.ring}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            className="handle"
          >
            <title>{pointName(id)}</title>
          </circle>
        ))}
      </g>
    );
  }
  /** Arrastar é o normal; escolher pelo nome e o passo de 1 px ficam aqui. */
  function fineTuning() {
    return (
      <>
        <p className="picked">
          {selectedPoint ? (
            <>
              <b>{JOINTS[Number(selected)]}</b> · {sure(selectedPoint.v)}
            </>
          ) : tracked ? (
            'Carrega num ponto do vídeo.'
          ) : (
            'Sem corpo neste fotograma.'
          )}
        </p>
        <details className="fine">
          <summary>
            Ajuste fino<small>nome, clique, 1 px</small>
          </summary>
          <div className="fine-body">
            <Choice
              label="Articulação"
              value={selected}
              onChange={setSelected}
              items={Object.entries(JOINTS)}
            />
            <button
              className="full"
              disabled={!canEdit}
              onClick={() => {
                video.current?.pause();
                setPlacing(selected);
              }}
            >
              <MousePointer2 size={16} />
              Colocar com um clique
            </button>
            <div className="nudges">
              <span>1 px</span>
              <div className="dpad">
                {(
                  [
                    ['up', 0, -1, '↑', 'para cima'],
                    ['left', -1, 0, '←', 'para a esquerda'],
                    ['down', 0, 1, '↓', 'para baixo'],
                    ['right', 1, 0, '→', 'para a direita'],
                  ] as [string, number, number, string, string][]
                ).map(([k, x, y, glyph, pt]) => (
                  <button
                    key={k}
                    className={`dpad-${k}`}
                    aria-label={`Mexer ${pt}`}
                    disabled={!canEdit}
                    onClick={() => nudge(x, y)}
                  >
                    {glyph}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>
      </>
    );
  }
  return (
    <main className="studio">
      <header>
        <div className="header-actions">
          {!connected && (
            <span className="chip warn">
              <i />
              Analisador desligado
              <button className="link" onClick={checkHealth}>
                ver
              </button>
            </span>
          )}
          <button disabled={busy} onClick={openProject}>
            <FolderOpen size={16} />
            Abrir projeto
          </button>
          <button
            disabled={!p.video.duration || busy}
            onClick={exportProject}
            title="Guardar num ficheiro .stroke.json (Ctrl+S)"
          >
            <Download size={16} />
            Guardar
            {dirty && (
              <>
                <i className="unsaved" aria-hidden="true" />
                <span className="sr-only">tens alterações por guardar</span>
              </>
            )}
          </button>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) newVideo(f);
          e.target.value = '';
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importProject(f);
          e.target.value = '';
        }}
      />
      <div className="videobar">
        <strong
          className="filename"
          data-empty={!p.video.name || undefined}
          title={p.video.name || undefined}
        >
          {p.video.name || 'Sem vídeo'}
        </strong>
        {src && (
          <small>
            {w} × {h} · {fmt(p.video.duration)}
          </small>
        )}
        <button disabled={busy} title={videoAction} onClick={openVideo}>
          <Upload size={15} />
          {videoAction}
        </button>
      </div>
      <div className="workspace">
        <section className="viewer">
          <div className={`stage ${placingNow ? 'placing' : ''}`}>
            {src ? (
              <div
                className="video-wrap"
                style={
                  {
                    aspectRatio: `${w}/${h}`,
                    '--ar': `${w / h}`,
                  } as React.CSSProperties
                }
              >
                <video
                  ref={video}
                  src={src}
                  onLoadedMetadata={metadata}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                  onError={() =>
                    say('Não deu para ler o vídeo. Tenta MP4 H.264.', 'warn')
                  }
                  muted
                  playsInline
                />
                <svg
                  className="overlay"
                  viewBox={`0 0 ${w} ${h}`}
                  preserveAspectRatio="none"
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={() => {
                    regionStart.current = null;
                    setRegionDraft(null);
                    if (drag.current) {
                      setP(drag.current.before);
                      drag.current = null;
                    }
                  }}
                  aria-label="Esqueleto do atleta e pá, editáveis"
                >
                  {(regionDraft || p.athleteRegion) && (() => {
                    const r = regionDraft || followedFrame?.region || p.athleteRegion!;
                    return <rect x={r.x*w} y={r.y*h} width={r.width*w} height={r.height*h}
                      fill="rgba(255,216,77,0.06)" stroke={followedFrame?.regionStatus === 'uncertain' ? '#ff885c' : '#ffd84d'} strokeWidth={2}
                      strokeDasharray="8 5" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
                  })()}
                  {paths.map((path, i) => (
                    <polyline
                      key={i}
                      points={path.points}
                      fill="none"
                      stroke={path.ink}
                      strokeWidth={2}
                      opacity={0.55}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {showRaw && skeleton(raw, INK.before, false, true)}
                  {skeleton(reviewedPose, null, mode === 'correct')}
                  {p.targetEnabled &&
                    showTarget &&
                    skeleton(reviewedTarget, INK.target, mode === 'target')}
                  {inSegment && paddleDrawing(paddle, INK.paddle)}
                  {inSegment &&
                    p.targetEnabled &&
                    showTarget &&
                    paddleDrawing(targetPaddle, INK.target, true)}
                </svg>
                <div className="hud">
                  <span className="hud-time">{fmt(time)}</span>
                  <span className="hud-mode">{MODES[mode].hud}</span>
                </div>
                {busy && (
                  <div className="stage-veil">
                    <LoaderCircle size={26} className="spin" />
                    <strong>{progress}%</strong>
                  </div>
                )}
                {!busy && tracked && !inSegment && (
                  <div className="stage-note">
                    <TriangleAlert size={15} />
                    Fora do trecho analisado
                    <button onClick={() => seek(p.segment[0])}>Ir</button>
                  </div>
                )}
                {placingNow && (
                  <div className="place-hint">
                    Carrega para colocar {pointName(placingNow)}
                    <button
                      onClick={() => setPlacing(null)}
                      aria-label="Cancelar"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty">
                {relinking && (
                  <>
                    <h2>Falta o vídeo</h2>
                    <p>
                      <b>{p.video.name}</b>
                    </p>
                  </>
                )}
                <button className="primary" onClick={openVideo}>
                  <Upload size={16} />
                  {videoAction}
                </button>
              </div>
            )}
          </div>
          <div className="timeline">
            <div className="scrub">
              <div className="track" aria-hidden="true">
                <div className="track-inner">
                  {bands.map(([a, b]) => (
                    <span
                      key={a}
                      className="band"
                      style={{
                        left: `${pct(a)}%`,
                        width: `${Math.max(0.4, pct(b) - pct(a))}%`,
                      }}
                    />
                  ))}
                  <span
                    className="window"
                    style={{
                      left: `${pct(p.segment[0])}%`,
                      width: `${pct(p.segment[1]) - pct(p.segment[0])}%`,
                    }}
                  />
                  {p.events.map((e) => (
                    <span
                      key={e.id}
                      className={`tick ${e.kind === 'Catch' ? 'catch' : 'exit'}`}
                      style={{ left: `${pct(e.t)}%` }}
                    />
                  ))}
                </div>
              </div>
              <input
                className="range range-time"
                type="range"
                aria-label="Posição no vídeo"
                min={0}
                max={Number(duration.toFixed(3))}
                step="any"
                value={Math.min(time, duration)}
                disabled={!src || busy}
                onChange={(e) => seek(Number(e.target.value))}
              />
              {(['in', 'out'] as const).map((edge) => (
                <input
                  key={edge}
                  className={`range range-seg range-${edge}`}
                  type="range"
                  aria-label={
                    edge === 'in'
                      ? 'Início do trecho, em segundos'
                      : 'Fim do trecho, em segundos'
                  }
                  min={0}
                  max={Number(duration.toFixed(3))}
                  step="any"
                  value={p.segment[edge === 'in' ? 0 : 1]}
                  disabled={!src || busy}
                  onChange={(e) => dragSegment(edge, Number(e.target.value))}
                  onPointerUp={endSegmentEdit}
                  onKeyUp={endSegmentEdit}
                  onBlur={endSegmentEdit}
                />
              ))}
            </div>
            <div className="timeline-labels">
              <span>{fmt(time)}</span>
              <span>{fmt(p.video.duration)}</span>
            </div>
          </div>
          <div className="transport">
            <button
              aria-label="Fotograma anterior"
              title="Fotograma anterior (←)"
              disabled={!src || busy}
              onClick={() => seek(time - 1 / p.video.fps)}
            >
              <SkipBack size={16} />
            </button>
            <button
              className="primary"
              aria-label={playing ? 'Pausa' : 'Reproduzir'}
              title="Reproduzir ou pausar (espaço)"
              disabled={!src || busy}
              onClick={togglePlay}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              aria-label="Fotograma seguinte"
              title="Fotograma seguinte (→)"
              disabled={!src || busy}
              onClick={() => seek(time + 1 / p.video.fps)}
            >
              <SkipForward size={16} />
            </button>
            <Choice
              label="Velocidade"
              value={speed}
              onChange={setSpeed}
              items={[
                ['0.25', '¼×'],
                ['0.5', '½×'],
                ['1', '1×'],
                ['2', '2×'],
              ]}
            />
            <Toggle checked={loop} onChange={setLoop}>
              Repetir
            </Toggle>
            <span className="layers">
              <Toggle checked={showRaw} onChange={setShowRaw}>
                <i className="sw" style={{ background: INK.before }} />
                Antes
              </Toggle>
              <Toggle
                checked={showTarget}
                onChange={setShowTarget}
                disabled={!p.targetEnabled}
              >
                <i className="sw" style={{ background: INK.target }} />
                Ideal
              </Toggle>
              <Toggle checked={showPaths} onChange={setShowPaths}>
                <i className="sw trail" />
                Rasto
              </Toggle>
            </span>
            <details className="shortcuts">
              <summary>
                <Keyboard size={14} />
                <span className="sr-only">Atalhos</span>
              </summary>
              <ul>
                <li>
                  <kbd>Espaço</kbd> reproduzir
                </li>
                <li>
                  <kbd>←</kbd> <kbd>→</kbd> um fotograma
                </li>
                <li>
                  <kbd>Ctrl</kbd>+<kbd>Z</kbd> anular
                </li>
                <li>
                  <kbd>Ctrl</kbd>+<kbd>S</kbd> guardar
                </li>
              </ul>
            </details>
          </div>
          <div className="analyse">
            <div className="segment-fields">
              <span className="eyebrow">TRECHO</span>
              <input
                type="number"
                aria-label="Início do trecho, em segundos"
                step="0.1"
                min={0}
                max={p.segment[1] - 0.1}
                disabled={!src || busy}
                value={Number(p.segment[0].toFixed(3))}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) commit(setSegment('in', n, p));
                }}
              />
              <button
                disabled={!src || busy || time >= p.segment[1] - 0.1}
                title="Pôr o início onde o vídeo está parado"
                onClick={() => commit(setSegment('in', time, p))}
              >
                aqui
              </button>
              <span className="dash">–</span>
              <input
                type="number"
                aria-label="Fim do trecho, em segundos"
                step="0.1"
                min={p.segment[0] + 0.1}
                max={p.video.duration}
                disabled={!src || busy}
                value={Number(p.segment[1].toFixed(3))}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) commit(setSegment('out', n, p));
                }}
              />
              <button
                disabled={!src || busy || time <= p.segment[0] + 0.1}
                title="Pôr o fim onde o vídeo está parado"
                onClick={() => commit(setSegment('out', time, p))}
              >
                aqui
              </button>
              <span className={segmentLength > 120 ? 'warn-text' : 'dim'}>
                {segmentLength.toFixed(1)} s
              </span>
            </div>
            <div className="analyse-action">
              {src && <button disabled={busy} aria-pressed={p.analysisQuality === 'detailed'}
                title="Análise detalhada: modelo Heavy, até 30 fps. Mais lenta."
                onClick={() => commit({...p, analysisQuality: p.analysisQuality === 'detailed' ? 'standard' : 'detailed'})}>
                {p.analysisQuality === 'detailed' && <Check size={14} />} Detalhada
              </button>}
              {src && <button disabled={busy} aria-pressed={selectingRegion}
                title="Selecionar área do atleta: arrasta um retângulo no vídeo"
                onClick={() => {
                  video.current?.pause();
                  if (!selectingRegion) seek(p.segment[0]);
                  setSelectingRegion(!selectingRegion);
                  setRegionDraft(null);
                  regionStart.current = null;
                }}>
                {selectingRegion ? 'Cancelar seleção' : 'Área do atleta'}
              </button>}
              {src && p.athleteRegion && <button disabled={busy || selectingRegion}
                aria-pressed={!!p.followAthlete}
                title="Experimental: seguir a área na próxima deteção. Laranja: movimento incerto."
                onClick={() => commit({...p, followAthlete: !p.followAthlete})}>
                {p.followAthlete && <Check size={14} />} Seguir
              </button>}
              {src && p.athleteRegion && <button disabled={busy} onClick={() => {
                commit({...p, athleteRegion: undefined, followAthlete: false});
                setSelectingRegion(false);
                setRegionDraft(null);
                regionStart.current = null;
              }}>Vídeo inteiro</button>}
              {src && blocked && <small className="warn-text">{blocked}</small>}
              <button
                className="primary"
                disabled={!!blocked || selectingRegion}
                onClick={startTracking}
              >
                <ScanLine size={17} />
                Detetar o atleta
              </button>
            </div>
          </div>
          {busy && (
            <div className="job-progress">
              <Progress aria-label="Progresso da deteção" value={progress} />
              <div>
                <span>A detetar… {progress}%</span>
                <button
                  onClick={() => {
                    cancelled.current = true;
                    if (job)
                      void analyzerFetch(`/jobs/${job}`, {
                        method: 'DELETE',
                      }).catch(() => {});
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          <div className="angles">
            {metrics.map(([label, a, b]) => (
              <div className="metric" key={label}>
                <span>{label}</span>
                <strong title={a === null ? 'Sem ponto fiável' : undefined}>
                  {deg(a)}
                </strong>
                {p.targetEnabled && a !== null && b !== null && (
                  <small className="ideal">
                    {b - a >= 0 ? '+' : ''}
                    {(b - a).toFixed(1)}°
                  </small>
                )}
              </div>
            ))}
            <p className="angles-note">Medidos na imagem plana, não em 3D.</p>
          </div>
        </section>
        <aside>
          <div>
            <fieldset className="modes">
              <legend className="sr-only">O que estás a editar no vídeo</legend>
              <div>
                {Object.entries(MODES).map(([key, m]) => (
                  <label
                    key={key}
                    className="mode"
                    data-active={mode === key || undefined}
                  >
                    <input
                      type="radio"
                      name="stroke-mode"
                      value={key}
                      checked={mode === key}
                      onChange={() => selectMode(key)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
              <div className="undo">
                <button
                  aria-label="Anular"
                  title="Anular (Ctrl+Z)"
                  disabled={!undoCount || busy}
                  onClick={undo}
                >
                  <Undo2 size={15} />
                </button>
                <button
                  aria-label="Refazer"
                  title="Refazer (Ctrl+Y)"
                  disabled={!redoCount || busy}
                  onClick={redo}
                >
                  <Redo2 size={15} />
                </button>
              </div>
            </fieldset>
            {mode === 'correct' && (
              <>
                <p className="help">
                  Pausa e arrasta um ponto para o sítio certo. A correção
                  suaviza-se nos fotogramas à volta.
                </p>
                {fineTuning()}
              </>
            )}
            {mode === 'paddle' && (
              <>
                <p className="help">
                  Marca A→B na pagaia e 1→2 na referência, sempre no mesmo
                  sentido. Vários fotogramas animam a pagaia.
                </p>
                <div className="paddle-buttons">
                  {PADDLE_POINTS.map(([id, label]) => (
                    <button
                      key={id}
                      disabled={!src || busy || !inSegment}
                      className={placingNow === id ? 'active' : ''}
                      onClick={() => {
                        video.current?.pause();
                        setPlacing(id);
                      }}
                    >
                      {paddle[id] ? <Check size={14} /> : <Plus size={14} />}
                      {label}
                    </button>
                  ))}
                </div>
                <p className="picked">
                  {Object.keys(paddle).length}/4 ·{' '}
                  {deg(paddleAngle(paddle, w, h))}
                </p>
                <button
                  className="full"
                  disabled={!paddleKeyHere || busy}
                  onClick={() =>
                    commit({
                      ...p,
                      paddle: p.paddle.filter(
                        (k) => Math.abs(k.t - time) > 0.04,
                      ),
                    })
                  }
                >
                  <X size={15} />
                  Apagar marcas deste fotograma
                </button>
              </>
            )}
            {mode === 'target' &&
              (p.targetEnabled ? (
                <>
                  <p className="help">
                    Arrasta o esqueleto laranja e compara com o real. É um
                    desenho livre: não respeita o comprimento dos membros.
                  </p>
                  {fineTuning()}
                </>
              ) : (
                <div className="target-intro">
                  <p>Uma cópia laranja que podes moldar, para comparar.</p>
                  <button
                    className="primary full"
                    disabled={!corrected || busy}
                    onClick={() => {
                      commit({ ...p, targetEnabled: true });
                      setShowTarget(true);
                    }}
                  >
                    Criar movimento ideal
                  </button>
                </div>
              ))}
            <div className="events">
              <h3>Ataque e saída</h3>
              <Choice
                label="Que pá"
                value={side}
                onChange={setSide}
                items={SIDES}
              />
              <div className="row">
                <button
                  disabled={!src || busy || !inSegment}
                  onClick={() => mark('Catch')}
                >
                  <Flag size={14} />
                  Ataque
                </button>
                <button
                  disabled={!src || busy || !inSegment}
                  onClick={() => mark('Exit')}
                >
                  <Flag size={14} />
                  Saída
                </button>
              </div>
              <div className="event-list">
                {p.events.map((e) => (
                  <div className="event" key={e.id}>
                    <button disabled={!src || busy} onClick={() => seek(e.t)}>
                      <i className={e.kind === 'Catch' ? 'catch' : 'exit'} />
                      {KIND_WORD[e.kind]} · {SIDE_WORD[e.side]}
                      <time>{fmt(e.t)}</time>
                    </button>
                    <button
                      aria-label={`Apagar ${KIND_WORD[e.kind]} da ${SIDE_WORD[e.side]} em ${fmt(e.t)}`}
                      disabled={busy}
                      onClick={() =>
                        commit({
                          ...p,
                          events: p.events.filter((x) => x.id !== e.id),
                        })
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            {keysHere.length > 0 && (
              <div className="keyframes">
                <h3>Fotogramas editados</h3>
                <div className="key-list">
                  {keysHere.map((k) => (
                    <button
                      key={k.t}
                      disabled={!src || busy}
                      title="Ir para este fotograma"
                      onClick={() => seek(k.t)}
                    >
                      {fmt(k.t)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {src && <details>
              <summary>Rever movimento ({reviewFlags.length})</summary>
              <div className="key-list">
                {reviewFlags.length === 0 ? <small>Sem saltos isolados sinalizados.</small> :
                  reviewFlags.map(f => <button key={`${f.t}-${f.joint}`} disabled={busy}
                    title={`${JOINTS[f.joint]}: ${f.kind === 'swap' ? 'possível troca de lados' : 'possível salto'}. Rever no vídeo.`}
                    onClick={() => { video.current?.pause(); seek(f.t); setMode('correct'); setSelected(String(f.joint)); }}>
                    {fmt(f.t)} · {JOINTS[f.joint]} · {f.kind === 'swap' ? 'troca?' : 'salto?'}
                  </button>)}
              </div>
            </details>}
            {src && <details>
              <summary>Transições ({p.transitions?.length || 0})</summary>
              <div className="key-list">
                <button disabled={busy || (transitionStart !== null && time <= transitionStart)}
                  title="Marca o início e o fim da transição; volta a detetar para aplicar."
                  onClick={() => {
                    video.current?.pause();
                    if (transitionStart === null) { setTransitionStart(time); return; }
                    const ranges: [number,number][] = [...(p.transitions || []), [transitionStart,time]];
                    ranges.sort((a,b) => a[0]-b[0]);
                    const merged: [number,number][] = [];
                    for (const r of ranges) {
                      const last = merged[merged.length-1];
                      if (last && r[0] <= last[1]) last[1] = Math.max(last[1],r[1]);
                      else merged.push([...r]);
                    }
                    if (merged.length > 100) { say('Máximo de 100 transições.', 'warn'); return; }
                    commit({...p, transitions:merged}); setTransitionStart(null);
                    say('Transição marcada. Volta a detetar para aplicar.', 'info');
                  }}>
                  {transitionStart === null ? 'Marcar início' : `Marcar fim (${fmt(transitionStart)})`}
                </button>
                {transitionStart !== null && <button disabled={busy} onClick={() => setTransitionStart(null)}>Cancelar</button>}
                {(p.transitions || []).map(([a,b],i) => <span key={`${a}-${b}`}>
                  <button disabled={busy} onClick={() => seek(a)}>{fmt(a)}–{fmt(b)}</button>
                  <button disabled={busy} aria-label={`Remover transição ${i+1}`}
                    onClick={() => commit({...p,transitions:p.transitions!.filter((_,j) => j!==i)})}><X size={12}/></button>
                </span>)}
              </div>
            </details>}
            <label className="field-label" htmlFor="notes">
              Notas
            </label>
            <textarea
              id="notes"
              disabled={busy}
              placeholder="O que mudavas nesta remada?"
              value={p.notes}
              onChange={(e) => {
                setP({ ...p, notes: e.target.value });
                setDirty(true);
              }}
            />
          </div>
        </aside>
      </div>
      <div className="toasts" aria-live="polite">
        {note.text && (
          <div className="toast" data-tone={note.tone}>
            {note.tone === 'ok' ? (
              <CircleCheck size={16} />
            ) : note.tone === 'warn' ? (
              <TriangleAlert size={16} />
            ) : note.tone === 'busy' ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Info size={16} />
            )}
            <span>{note.text}</span>
            <button onClick={hush} aria-label="Fechar aviso">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="dialog-quiet"
              onClick={() => setConfirmOpen(false)}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className={confirm?.danger ? 'dialog-danger' : 'primary'}
              onClick={() => {
                const c = confirm;
                setConfirmOpen(false);
                c?.run();
              }}
            >
              {confirm?.action}
            </AlertDialogAction>
            {confirm?.offerSave && (
              <button
                className="primary"
                onClick={async () => {
                  const c = confirm;
                  if (await exportProject()) {
                    setConfirmOpen(false);
                    c.run();
                  }
                }}
              >
                <Download size={15} />
                Guardar primeiro
              </button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
