'use client';
import StrokeComparison from './StrokeComparison';
import Pose3D from './Pose3D';
import { useDrawing, DrawingLayer, DrawingToolbar } from './Drawing';
import ThemeToggle from './ThemeToggle';
import UpdateButton from './UpdateButton';
import Timeline, { fmt, type EditMode } from './Timeline';
import Shortcuts from './Shortcuts';
import { clock, useClock } from '@/lib/clock';
import { editorKeysBlocked } from '@/lib/keys';
import { desktop, analyzerFetch, analyzerError, desktopVideoFile, type DesktopProject, type DesktopVideo } from '@/lib/desktop';
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
  ChartNoAxesColumn,
  Plus,
  X,
  Info,
  CircleCheck,
  TriangleAlert,
  LoaderCircle,
  Check,
  Keyboard,
  PersonStanding,
  Ruler,
  Target,
  Rotate3d,
  PanelRightClose,
  Brush,
  Maximize,
  Minimize,
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
  frameIndex,
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
  mergeRanges,
  unbreak,
  type Project,
  type Point,
  type Frame,
  type Region,
  type MotionFlag,
} from '@/lib/motion';
type AnalysisResult = {
  fps: number;
  start: number;
  end: number;
  frames: Frame[];
  detected: number;
  total: number;
  sampleFps: number;
  /** Cortes de câmara detetados; ausente em analisadores antigos. */
  cuts?: [number, number][];
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
  ['a', 'Pagaia A'],
  ['b', 'Pagaia B'],
  ['r1', 'Referência 1'],
  ['r2', 'Referência 2'],
];
/** As ferramentas da barra escolhem o que se arrasta por cima do vídeo. */
const MODES: Record<EditMode, { label: string; hud: string; icon: typeof Ruler }> = {
  correct: { label: 'Corpo', hud: 'Arrasta os pontos', icon: PersonStanding },
  paddle: { label: 'Pagaia', hud: 'Carrega para pôr um ponto', icon: Ruler },
  target: { label: 'Editar ideal', hud: 'Arrasta o esqueleto laranja', icon: Target },
};
/** O que o painel à direita mostra; null fecha-o e o vídeo cresce. */
type Panel = 'setup' | 'tool' | 'times' | '3d' | null;
/** Os separadores do cabeçalho: cada um abre o seu painel, e fecha-o outra vez. */
const VIEWS: [Exclude<Panel, 'tool' | null>, string, typeof Ruler][] = [
  ['setup', 'Deteção', ScanLine],
  ['times', 'Tempos', ChartNoAxesColumn],
  ['3d', 'Vista 3D', Rotate3d],
];
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
  title,
  children,
}: {
  checked: boolean;
  onChange: (x: boolean) => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="toggle" data-disabled={disabled || undefined} title={title}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      {children}
    </label>
  );
}
/** O browser diz que fotograma pintou (Chrome, Edge, Safari, Electron). */
const framed =
  typeof HTMLVideoElement !== 'undefined' &&
  'requestVideoFrameCallback' in HTMLVideoElement.prototype;
/**
 * Funções com identidade fixa que chamam sempre a versão mais recente: assim
 * a doca e o transporte não se redesenham só porque o Studio se redesenhou.
 */
function useStable<T extends Record<string, (...args: never[]) => unknown>>(fns: T): T {
  const latest = useRef(fns);
  useLayoutEffect(() => {
    latest.current = fns;
  });
  const [stable] = useState(
    // oxlint-disable-next-line react/react-compiler -- só leem a ref quando chamadas, nunca no render
    () =>
      Object.fromEntries(
        Object.keys(fns).map((k) => [k, (...args: never[]) => latest.current[k](...args)]),
      ) as T,
  );
  return stable;
}
/** O relógio do transporte: só ele muda a cada fotograma. */
function ClockText() {
  return fmt(useClock());
}
export default function Studio() {
  const [p, setP] = useState<Project>(emptyProject),
    [src, setVideoSrc] = useState(''),
    [file, setFile] = useState<File | DesktopVideo | null>(null),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState('0.5'),
    [loop, setLoop] = useState(true);
  const time = useClock();
  const [mode, setMode] = useState<EditMode>('correct'),
    [showRaw, setShowRaw] = useState(false),
    [showTarget, setShowTarget] = useState(true),
    [showPaths, setShowPaths] = useState(false),
    [showAngles, setShowAngles] = useState(true),
    [selected, setSelected] = useState('15'),
    [placing, setPlacing] = useState<string | null>(null),
    [keysOpen, setKeysOpen] = useState(false),
    [note, setNote] = useState<{ text: string; tone: Tone }>({
      text: '',
      tone: 'info',
    }),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    // Cancelar responde logo: o botão desliga-se até o detetor confirmar.
    [cancelling, setCancelling] = useState(false),
    [job, setJob] = useState(''),
    [analyzer, setAnalyzer] = useState<'starting' | 'on' | 'off'>('starting'),
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
    drag = useRef<{ id: string; before: Project } | null>(null),
    scrubBefore = useRef<Project | null>(null),
    noteSeq = useRef(0),
    cancelled = useRef(false),
    dirtyRef = useRef(false);
  const [relinking, setRelinking] = useState(false);
  const [selectingRegion, setSelectingRegion] = useState(false);
  const [regionDraft, setRegionDraft] = useState<Region | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  // Apresentar: só o vídeo e o transporte, para mostrar ao atleta.
  const [present, setPresent] = useState(false);
  const reviewLoop = useRef<[number, number] | null>(null);
  // O último fotograma pintado e quantas vezes a imagem encravou: para dar
  // com um descodificador parado.
  const lastFrame = useRef({ at: 0, t: 0 });
  const stalls = useRef(0);
  // A velocidade de antes de rever uma pagaiada, para voltar a ela no fim.
  const speedBefore = useRef<string | null>(null);
  /** Acaba a revisão de uma pagaiada: deixa de repetir e repõe a velocidade. */
  function endReview() {
    reviewLoop.current = null;
    if (speedBefore.current === null) return;
    setSpeed(speedBefore.current);
    speedBefore.current = null;
  }
  const [transitionStart, setTransitionStart] = useState<number | null>(null);
  const regionStart = useRef<Point | null>(null);
  function setSrc(value: string) {
    stalls.current = 0;
    endReview();
    setTransitionStart(null);
    setVideoSrc(value);
    setSelectingRegion(false);
    setRegionDraft(null);
    regionStart.current = null;
  }
  const [desktopReady, setDesktopReady] = useState(false);
  useLayoutEffect(() => {
    current.current = p;
    dirtyRef.current = dirty;
  }, [p, dirty]);
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
    endReview();
    const v = video.current;
    if (v && src && !busy) {
      v.pause();
      v.currentTime = clamp(
        t,
        0,
        Math.max(0, p.video.duration - 1 / p.video.fps),
      );
      clock.set(v.currentTime);
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
      .then((x) => setAnalyzer(x.ok && x.modelReady ? 'on' : 'off'))
      .catch(() => setAnalyzer('off'));
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
      if (newVideo(selected)) {
        if (!relinking) await desktop()!.resetProject();
        await desktop()!.rememberVideo(selected.id);
      }
    } catch (e) { say(e instanceof Error ? e.message : 'Não foi possível abrir o vídeo.', 'warn'); }
  }
  async function importProject(f: File) {
    try {
      if (f.size > 100 * 1024 ** 2) throw Error('Projeto com mais de 100 MB.');
      const loaded = parseProject(JSON.parse(await f.text()));
      video.current?.pause();
      setP(loaded);
      setFile(null);
      setSrc('');
      clock.set(loaded.segment[0]);
      setRelinking(true);
      history.current = [];
      future.current = [];
      setUndoCount(0);
      setRedoCount(0);
      setDirty(false);
      setMode('correct');
      setPanel(loaded.frames.length ? null : 'setup');
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
      setFile(selected); setSrc(selected.url);
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
  function newVideo(f: File | DesktopVideo) {
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
    setSrc(f instanceof File ? URL.createObjectURL(f) : f.url);
    setFile(f);
    clock.set(0);
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
      setPanel('setup');
      say('Vídeo pronto. Escolhe Detetar a minha remada.', 'ok');
    }
    return true;
  }
  function replayStroke(a: number, b: number) {
    if (!video.current || !src || busy || b <= a) return;
    const before = speedBefore.current ?? speed;
    seek(a);
    reviewLoop.current = [a, b];
    speedBefore.current = before;
    setSpeed('0.25');
    video.current.playbackRate = .25;
    void video.current.play().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        say('Não foi possível reproduzir o vídeo.', 'warn');
    });
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
    if (desktop() && desktopReady) desktop()!.dirty(dirty);
  }, [dirty, desktopReady]);
  // A cópia de recuperação serializa o projeto inteiro: escreve-se 1 s depois
  // da última alteração e nunca a meio de arrastar uma articulação ou o trecho.
  useEffect(() => {
    if (!desktop() || !desktopReady || !p.video.name) return;
    let id = 0;
    const write = () => {
      if (drag.current || scrubBefore.current) id = window.setTimeout(write, 1000);
      else void desktop()!.snapshot(JSON.stringify(p), dirty)
        .catch(() => say('Não foi possível criar a cópia de recuperação. Guarda o projeto.', 'warn'));
    };
    id = window.setTimeout(write, 1000);
    return () => clearTimeout(id);
  }, [p, dirty, desktopReady]);
  // Ao fechar, a última alteração ainda pode estar à espera do intervalo.
  useEffect(() => {
    if (!desktop() || !desktopReady) return;
    return desktop()!.onFlush(() => void desktop()!.snapshot(JSON.stringify(current.current), dirtyRef.current));
  }, [desktopReady]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = Number(speed);
  }, [speed, src]);
  // A reproduzir, o tempo é o do fotograma que está no ecrã, não o do relógio
  // do vídeo: se o descodificador se atrasa, a imagem congela mas o relógio
  // continua, e o esqueleto fugia para um momento que ainda não se vê.
  useEffect(() => {
    const v = video.current;
    if (!v || !src || !framed) return;
    let id = 0;
    const onFrame: VideoFrameRequestCallback = (_, frame) => {
      lastFrame.current = { at: performance.now(), t: frame.mediaTime };
      // O último fotograma pode dizer-se um pouco depois do fim do vídeo.
      if (!v.paused) clock.set(Math.min(frame.mediaTime, v.duration || Infinity));
      id = v.requestVideoFrameCallback(onFrame);
    };
    id = v.requestVideoFrameCallback(onFrame);
    return () => v.cancelVideoFrameCallback(id);
  }, [src]);
  const warnStall = useEffectEvent(() =>
    say('O vídeo encrava a reproduzir neste computador. Se continuar, converte-o para MP4 (H.264).', 'warn'),
  );
  useEffect(() => {
    let handle = 0;
    const tick = () => {
      const v = video.current;
      if (v && !v.paused) {
        // Há descodificadores que param de dar fotogramas a meio (vídeos do
        // YouTube, sem som): um segundo sem imagem nova, salta para onde o
        // vídeo devia ir, o que os põe a andar outra vez.
        const f = lastFrame.current, now = performance.now();
        if (!framed || v.seeking) f.at = now;
        else if (now - f.at > 1000) {
          f.at = now;
          v.currentTime = Math.max(v.currentTime, f.t + 1 / current.current.video.fps);
          if (++stalls.current === 3) warnStall();
        }
        const [a, b] = reviewLoop.current || current.current.segment;
        if (v.currentTime >= b) {
          if (loop || reviewLoop.current) {
            v.currentTime = a;
          } else {
            v.pause();
            v.currentTime = b;
          }
        }
        if (!framed || v.paused) clock.set(v.currentTime);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [loop]);
  const keyboardEvent = useEffectEvent((e: KeyboardEvent) => {
    if (editorKeysBlocked(e)) return;
    const el = e.target as HTMLElement;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (current.current.video.duration && !busy) void exportProject();
      return;
    }
    if (e.key === 'Escape') {
      if (selectingRegion) {
        toggleRegion();
        return;
      }
      setPlacing(null);
      hush();
      if (present) togglePresent();
      return;
    }
    if (busy) return;
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
    if (mod || e.altKey) return;
    const seg = current.current.segment;
    if (e.key === '?') {
      e.preventDefault();
      setKeysOpen(true);
      return;
    }
    // Letras e números valem com o foco num botão: não o carregam.
    if (e.key.toLowerCase() === 'f' && src) {
      togglePresent();
      return;
    }
    if (e.key.toLowerCase() === 'g' && src && !drawing.on) {
      selectMode(mode === 'target' ? 'correct' : 'target');
      return;
    }
    // I e O, como nos editores de vídeo: o trecho começa ou acaba aqui.
    const k = e.key.toLowerCase();
    if ((k === 'i' || k === 'o') && src && !drawing.on) {
      const t = clock.get(), edge = k === 'i' ? 'in' : 'out';
      if (edge === 'in' ? t < seg[1] - 0.1 : t > seg[0] + 0.1)
        commit(setSegment(edge, t, current.current));
      return;
    }
    // Espaço e setas são do vídeo mesmo com o foco num botão que se carregou
    // antes (Entrada, Repetir…); só os controlos que as usam ficam com elas.
    if (el.closest('[role="combobox"],[role="slider"]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    }
    // Shift salta um segundo; sozinhas, as setas andam um fotograma.
    const step = e.shiftKey ? 1 : 1 / current.current.video.fps;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      seek(clock.get() + step);
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(clock.get() - step);
    }
    if (e.key === 'Home') {
      e.preventDefault();
      seek(seg[0]);
    }
    if (e.key === 'End') {
      e.preventDefault();
      seek(seg[1]);
    }
  });
  useEffect(() => {
    const fn = () => {
      if (!document.fullscreenElement) setPresent(false);
    };
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);
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
                time: clock.get(),
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
      clock.set(p.segment[0]);
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
    endReview();
    setBusy(true);
    setProgress(0);
    cancelled.current = false;
    say('A preparar o vídeo…', 'busy');
    let id = '';
    try {
      const form = new FormData();
      form.append('file', file instanceof File ? file : await desktopVideoFile(file));
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
      if (!response.ok) throw analyzerError(data.detail);
      id = data.id;
      setJob(id);
      setAnalyzer('on');
      say('À procura do atleta…', 'busy');
      while (true) {
        if (cancelled.current)
          await analyzerFetch(`/jobs/${id}`, { method: 'DELETE' });
        const response = await analyzerFetch(`/jobs/${id}`);
        const data = (await response.json()) as JobResponse;
        if (!response.ok) throw analyzerError(data.detail);
        setProgress(data.progress);
        if (data.status === 'error') throw analyzerError(data.error);
        if (data.status === 'cancelled') {
          say('Deteção cancelada.', 'info');
          break;
        }
        if (data.status === 'done') {
          if (cancelled.current) {
            say('Deteção cancelada.', 'info');
            break;
          }
          const r = data.result;
          const old = current.current;
          // Cortes de câmara encontrados pelo analisador passam a transições
          // no mesmo passo, para um só Ctrl+Z desfazer tudo. Os que o
          // treinador já tirou não voltam.
          const rejected = old.rejectedCuts || [];
          const cuts = (r.cuts || []).filter(
            ([a, b]) => !rejected.some(([c, d]) => a <= d && b >= c),
          );
          const transitions = mergeRanges(old.transitions || [], cuts);
          const fits = transitions.length <= 100;
          commit({
            ...old,
            ...(cuts.length && fits ? { transitions } : {}),
            version: 2,
            video: { ...old.video, fps: r.fps },
            frames: [
              ...old.frames.filter((f) => f.t < r.start || f.t > r.end),
              ...unbreak(r.frames, rejected),
            ].sort((a, b) => a.t - b.t),
            corrections: old.corrections.filter(
              (k) => k.t < r.start || k.t > r.end,
            ),
            target: old.target.filter((k) => k.t < r.start || k.t > r.end),
          });
          const firstMoment = r.start;
          if (video.current) video.current.currentTime = firstMoment;
          clock.set(firstMoment);
          // A preparação já não é precisa: o painel fecha e o vídeo cresce.
          setPanel((x) => (x === 'setup' ? null : x));
          const n = cuts.length;
          const found = r.detected > r.total * 0.6;
          say(
            !found
              ? `Deteção pronta. Só encontrei o atleta em ${Math.round((r.detected / r.total) * 100)}% dos fotogramas: escolhe a área do atleta ou a deteção detalhada e volta a detetar.`
              : !n
              ? 'Deteção pronta. Podes rever o movimento e marcar as entradas e saídas no vídeo.'
              : !fits
                ? `Deteção pronta. Encontrei ${n} ${n === 1 ? 'corte' : 'cortes'} de câmara, mas já não cabem mais transições.`
                : n === 1
                  ? 'Deteção pronta. Encontrei 1 corte de câmara e marquei-o como transição.'
                  : `Deteção pronta. Encontrei ${n} cortes de câmara e marquei-os como transições.`,
            found ? 'ok' : 'warn',
          );
          break;
        }
        await new Promise((r) => setTimeout(r, 650));
      }
    } catch (e) {
      checkHealth();
      // Sem rede (TypeError) ou sem resposta do detetor (corpo vazio, SyntaxError).
      say(
        e instanceof TypeError || e instanceof SyntaxError
          ? 'O detetor não responde. Reinicia o Stroke.'
          : (e as Error).message,
        'warn',
      );
    } finally {
      setBusy(false);
      setCancelling(false);
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
  const drawing = useDrawing({ project: p, current, commit, time, playing,
    pose: reviewedPose, enabled: !!src && !busy, askConfirm, say });
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
  const w = p.video.width,
    h = p.video.height;
  const tracked = p.frames.length > 0;
  const duration = Math.max(0.01, p.video.duration);
  const segmentLength = p.segment[1] - p.segment[0];
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
        ? 'Já está a detetar.'
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
    const t = clock.get();
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
  /** Corpo não tem propriedades: escolhê-lo deixa o painel como está. */
  function selectMode(next: EditMode, toggle = false) {
    // Uma ferramenta de cada vez: escolher Corpo, Pagaia ou Ideal fecha o desenho.
    if (drawing.on) {
      drawing.open(false);
      toggle = false;
    }
    setMode(next);
    setPlacing(null);
    if (next === 'target') setShowTarget(true);
    if (next !== 'correct')
      setPanel((x) => (toggle && x === 'tool' && mode === next ? null : 'tool'));
    else setPanel((x) => (x === 'tool' ? null : x));
  }
  /** Desenhar é a quarta ferramenta: a paleta flutua no vídeo, sem painel. */
  function toggleDrawing() {
    const next = !drawing.on;
    drawing.open(next);
    if (next) {
      setPlacing(null);
      setPanel((x) => (x === 'tool' ? null : x));
    }
  }
  function togglePresent() {
    const next = !present;
    setPresent(next);
    // Ecrã inteiro quando o sistema deixa; se não deixar, fica só a janela limpa.
    const doc = document;
    if (next && !doc.fullscreenElement)
      void doc.documentElement.requestFullscreen?.().catch(() => {});
    if (!next && doc.fullscreenElement) void doc.exitFullscreen?.().catch(() => {});
  }
  function openView(next: Panel) {
    setPanel((x) => (x === next ? null : next));
  }
  function markTransition() {
    video.current?.pause();
    if (transitionStart === null) {
      setTransitionStart(time);
      return;
    }
    const merged = mergeRanges(p.transitions || [], [[transitionStart, time]]);
    if (merged.length > 100) {
      say('Máximo de 100 transições.', 'warn');
      return;
    }
    commit({ ...p, transitions: merged });
    setTransitionStart(null);
    say('Transição marcada. Volta a detetar para aplicar.', 'info');
  }
  function toggleRegion() {
    video.current?.pause();
    if (drawing.on) drawing.open(false);
    if (!selectingRegion) seek(p.segment[0]);
    setSelectingRegion(!selectingRegion);
    setRegionDraft(null);
    regionStart.current = null;
  }
  function cancelJob() {
    cancelled.current = true;
    setCancelling(true);
    if (job)
      void analyzerFetch(`/jobs/${job}`, { method: 'DELETE' }).catch(() => {});
  }
  const metrics = [
    [
      'Cotovelo esq.', LIMB.armL,
      angle(corrected?.[11], corrected?.[13], corrected?.[15], w, h),
      angle(target?.[11], target?.[13], target?.[15], w, h),
    ],
    [
      'Cotovelo dir.', LIMB.armR,
      angle(corrected?.[12], corrected?.[14], corrected?.[16], w, h),
      angle(target?.[12], target?.[14], target?.[16], w, h),
    ],
    [
      'Joelho esq.', LIMB.legL,
      angle(reviewedPose?.[23], reviewedPose?.[25], reviewedPose?.[27], w, h),
      angle(reviewedTarget?.[23], reviewedTarget?.[25], reviewedTarget?.[27], w, h),
    ],
    [
      'Joelho dir.', LIMB.legR,
      angle(reviewedPose?.[24], reviewedPose?.[26], reviewedPose?.[28], w, h),
      angle(reviewedTarget?.[24], reviewedTarget?.[26], reviewedTarget?.[28], w, h),
    ],
    [
      'Pagaia', INK.paddle,
      paddleAngle(paddle, w, h),
      paddleAngle(targetPaddle, w, h),
    ],
  ] as [string, string, number | null, number | null][];
  /** O rasto de cada pulso leva a cor do braço a que pertence. */
  const paths = useMemo(() => {
    if (!showPaths) return [];
    return [15, 16].flatMap((id) => {
      const chunks: string[] = [''];
      const end = Math.min(time, p.segment[1]);
      for (
        let i = frameIndex(p.frames, Math.max(p.segment[0], time - 1.5));
        i < p.frames.length && p.frames[i].t <= end;
        i++
      ) {
        const f = p.frames[i];
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
  const paddleKeyHere = p.paddle.some((k) => Math.abs(k.t - time) < 0.04);
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
  const ready = !!src && !busy;
  /** Ferramenta sem propriedades (Corpo) não abre painel nenhum. */
  const inspector: Panel =
    panel === 'tool' && mode === 'correct' ? null : panel;
  const panelTitle: Record<Exclude<Panel, null>, string> = {
    setup: 'Deteção',
    tool: MODES[mode].label,
    times: 'Tempos',
    '3d': 'Vista 3D',
  };
  const stable = useStable({
    commit,
    seek,
    togglePlay,
    togglePresent,
    toggleIdeal: () => selectMode(mode === 'target' && !drawing.on ? 'correct' : 'target'),
    toggleDrawing,
    replay: replayStroke,
    dragSegment,
    endSegmentEdit,
    markTransition,
    cancelTransition: () => setTransitionStart(null),
    onFlag: (f: MotionFlag) => {
      video.current?.pause();
      seek(f.t);
      selectMode('correct');
      setSelected(String(f.joint));
    },
    onKey: (m: EditMode, t: number) => {
      seek(t);
      // A pagaia já não tem ferramenta: os pontos editados só se mostram.
      if (m !== 'paddle' && m !== mode) selectMode(m);
    },
  });
  const transport = useMemo(() => (
    <>
      <div className="transport">
        <button
          aria-label="Fotograma anterior"
          title="Fotograma anterior (←)"
          disabled={!ready}
          onClick={() => stable.seek(clock.get() - 1 / p.video.fps)}
        >
          <SkipBack size={15} />
        </button>
        <button
          className="play"
          aria-label={playing ? 'Pausa' : 'Reproduzir'}
          title="Reproduzir ou pausar (espaço)"
          disabled={!ready}
          onClick={stable.togglePlay}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button
          aria-label="Fotograma seguinte"
          title="Fotograma seguinte (→)"
          disabled={!ready}
          onClick={() => stable.seek(clock.get() + 1 / p.video.fps)}
        >
          <SkipForward size={15} />
        </button>
        <span className="clock">
          <strong>
            <ClockText />
          </strong>
          <span>/ {fmt(p.video.duration)}</span>
        </span>
        <Choice
          label="Velocidade"
          value={speed}
          onChange={(v) => {
            // Escolher outra a meio da revisão fica para depois dela.
            speedBefore.current = null;
            setSpeed(v);
          }}
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
      </div>
      <fieldset className="layers">
        <legend className="sr-only">Camadas no vídeo</legend>
        <Toggle checked={showRaw} onChange={setShowRaw}>
          <i className="sw" style={{ background: INK.before }} />
          Original
        </Toggle>
        <Toggle
          checked={showTarget}
          onChange={setShowTarget}
          disabled={!p.targetEnabled}
          title={p.targetEnabled ? undefined : 'Cria primeiro o movimento ideal (Editar ideal)'}
        >
          <i className="sw" style={{ background: INK.target }} />
          Ideal
        </Toggle>
        <Toggle checked={showPaths} onChange={setShowPaths}>
          <i className="sw trail" />
          Rasto
        </Toggle>
        <Toggle checked={showAngles} onChange={setShowAngles}>
          Ângulos
        </Toggle>
      </fieldset>
      <button
        className="shortcuts"
        title="Atalhos do teclado (?)"
        onClick={() => setKeysOpen(true)}
      >
        <Keyboard size={14} />
        <kbd>?</kbd>
        <span className="sr-only">Atalhos do teclado</span>
      </button>
      {/* O que muda o que o vídeo faz fica junto do vídeo, ao lado de Apresentar. */}
      <span className="modes">
        <button
          aria-pressed={mode === 'target' && !drawing.on}
          disabled={!src}
          title={`Editar ideal: ${MODES.target.hud.toLowerCase()} (G)`}
          onClick={stable.toggleIdeal}
        >
          <Target size={15} />
          <span>Editar ideal</span>
        </button>
        <button
          aria-pressed={drawing.on}
          disabled={!src || busy}
          title="Desenhar por cima do vídeo (D)"
          onClick={stable.toggleDrawing}
        >
          <Brush size={15} />
          <span>Desenhar</span>
        </button>
      </span>
      <button
        className="present"
        aria-pressed={present}
        disabled={!src}
        title={present ? 'Voltar ao editor (F ou Esc)' : 'Só o vídeo, para mostrar ao atleta (F)'}
        onClick={stable.togglePresent}
      >
        {present ? <Minimize size={15} /> : <Maximize size={15} />}
        <span>{present ? 'Voltar' : 'Apresentar'}</span>
      </button>
    </>
  ), [ready, playing, speed, loop, showRaw, showTarget, showPaths, showAngles, present, src,
    busy, mode, drawing.on, p.targetEnabled, p.video.fps, p.video.duration, stable]);
  return (
    <main
      className="studio"
      data-video={src ? 'loaded' : undefined}
      data-present={(present && !!src) || undefined}
    >
      <header className="topbar">
        <div className="file">
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
            <Upload size={14} />
            {videoAction}
          </button>
        </div>
        <div className="header-actions">
          {analyzer === 'off' && (
            <span className="chip warn">
              <i />
              Detetor desligado
              <button className="link" onClick={checkHealth}>
                Tentar de novo
              </button>
            </span>
          )}
          <UpdateButton />
          <span className="history">
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
          </span>
          <nav className="view-tabs" aria-label="Painéis">
            {VIEWS.map(([key, label, Icon]) => (
              <button
                key={key}
                aria-pressed={inspector === key}
                // Um ponto simples, não uma cor: este vídeo ainda precisa da primeira deteção.
                data-attention={(key === 'setup' && !!src && !tracked && !busy) || undefined}
                title={key === 'setup' ? 'Trecho, área do atleta e deteção' : undefined}
                onClick={() => openView(key)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>
          <button disabled={busy} onClick={openProject}>
            <FolderOpen size={15} />
            Abrir projeto
          </button>
          <button
            disabled={!p.video.duration || busy}
            onClick={exportProject}
            title="Guardar num ficheiro .stroke.json (Ctrl+S)"
          >
            <Download size={15} />
            Guardar
            {dirty && (
              <>
                <i className="unsaved" aria-hidden="true" />
                <span className="sr-only">tens alterações por guardar</span>
              </>
            )}
          </button>
          <ThemeToggle />
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
      <div
        className="workspace"
        data-inspector={inspector || undefined}
      >
        <section className={`stage ${placingNow ? 'placing' : ''}`}>
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
                onPlay={() => {
                  lastFrame.current.at = performance.now();
                  setPlaying(true);
                }}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => {
                  if (!framed || e.currentTarget.paused) clock.set(e.currentTarget.currentTime);
                }}
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
                aria-label="Esqueleto do atleta e pagaia, editáveis"
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
              <DrawingLayer d={drawing} />
              <div className="hud">
                <span className="hud-time">{fmt(time)}</span>
                {(selectingRegion || (tracked && inSegment)) && (
                  <span className="hud-mode">
                    {selectingRegion ? 'Arrasta um retângulo' : MODES[mode].hud}
                  </span>
                )}
              </div>
              {showAngles && !busy && corrected && !drawing.on && (
                <dl
                  className="angle-chips"
                  title="Ângulos medidos na imagem plana, não em 3D."
                >
                  {metrics.map(([label, ink, a, b]) =>
                    a === null ? null : (
                      <div key={label}>
                        <dt>
                          <i style={{ background: ink }} />
                          {label}
                        </dt>
                        <dd>
                          {deg(a)}
                          {p.targetEnabled && b !== null && (
                            <small className="ideal">
                              {b - a >= 0 ? '+' : ''}
                              {(b - a).toFixed(1)}°
                            </small>
                          )}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              )}
              {busy && (
                <div className="stage-veil" data-cancelling={cancelling || undefined}>
                  <LoaderCircle size={24} className="spin" />
                  <strong>{progress}%</strong>
                  <Progress aria-label="Progresso da deteção" value={progress} />
                  <button disabled={cancelling} onClick={cancelJob}>
                    {cancelling ? 'A cancelar…' : 'Cancelar'}
                  </button>
                </div>
              )}
              {(drawing.on || present) && <DrawingToolbar d={drawing} />}
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
          <div className="stage-msgs">
            {!busy && tracked && !inSegment && src && (
              <div className="stage-note">
                <TriangleAlert size={15} />
                Fora do trecho detetado
                <button onClick={() => seek(p.segment[0])}>Ir</button>
              </div>
            )}
            {placingNow && (
              <div className="place-hint">
                Carrega para colocar {pointName(placingNow)}
                <button onClick={() => setPlacing(null)} aria-label="Cancelar">
                  <X size={14} />
                </button>
              </div>
            )}
            {selectingRegion && (
              <div className="place-hint">
                Arrasta à volta do atleta, com espaço para os braços
                <button onClick={toggleRegion} aria-label="Cancelar seleção">
                  <X size={14} />
                </button>
              </div>
            )}
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
          </div>
        </section>
        {inspector && (
          <aside className="inspector" aria-label={panelTitle[inspector]}>
            <div className="inspector-head">
              <h2>{panelTitle[inspector]}</h2>
              {inspector === '3d' && <span className="badge">Experimental</span>}
              <button
                className="inspector-close"
                aria-label="Fechar painel"
                title="Fechar painel"
                onClick={() => setPanel(null)}
              >
                <PanelRightClose size={16} />
              </button>
            </div>
            <div className="inspector-body">
              {inspector === 'setup' && (
                <div className="setup">
                  <div className="setup-row">
                    <span className="field-label">Trecho</span>
                    <div className="segment-fields">
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
                        title="Pôr o início onde o vídeo está parado (I)"
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
                        title="Pôr o fim onde o vídeo está parado (O)"
                        onClick={() => commit(setSegment('out', time, p))}
                      >
                        aqui
                      </button>
                    </div>
                    <small className={segmentLength > 120 ? 'warn-text' : 'dim'}>
                      {segmentLength.toFixed(1)} s · também se arrasta na linha do tempo
                    </small>
                  </div>
                  <div className="setup-row">
                    <span className="field-label">Atleta</span>
                    <div className="setup-buttons">
                      <button
                        disabled={!src || busy}
                        aria-pressed={selectingRegion}
                        title="Arrasta um retângulo no vídeo à volta do atleta"
                        onClick={toggleRegion}
                      >
                        {selectingRegion ? 'Cancelar seleção' : 'Área do atleta'}
                      </button>
                      {p.athleteRegion && (
                        <>
                          <button
                            disabled={!src || busy || selectingRegion}
                            aria-pressed={!!p.followAthlete}
                            title="Experimental: seguir a área na próxima deteção. Laranja: movimento incerto."
                            onClick={() => commit({ ...p, followAthlete: !p.followAthlete })}
                          >
                            {p.followAthlete && <Check size={14} />} Seguir
                          </button>
                          <button
                            disabled={!src || busy}
                            onClick={() => {
                              commit({ ...p, athleteRegion: undefined, followAthlete: false });
                              setSelectingRegion(false);
                              setRegionDraft(null);
                              regionStart.current = null;
                            }}
                          >
                            Vídeo inteiro
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <Toggle
                    checked={p.analysisQuality === 'detailed'}
                    disabled={!src || busy}
                    onChange={(checked) =>
                      commit({ ...p, analysisQuality: checked ? 'detailed' : 'standard' })
                    }
                  >
                    Deteção detalhada
                  </Toggle>
                  {(p.transitions?.length || 0) > 0 && (
                    <small className="dim">
                      {p.transitions!.length}{' '}
                      {p.transitions!.length === 1 ? 'transição fica' : 'transições ficam'} de fora
                    </small>
                  )}
                  <button
                    className="primary full"
                    disabled={!!blocked || selectingRegion || analyzer === 'starting'}
                    onClick={startTracking}
                  >
                    <ScanLine size={17} />
                    Detetar a minha remada
                  </button>
                  {blocked && !busy ? (
                    <small className="warn-text">{blocked}</small>
                  ) : (
                    analyzer === 'starting' && <small className="dim">A preparar a deteção…</small>
                  )}
                </div>
              )}
              {inspector === 'tool' && mode === 'paddle' && (
                <>
                  <p className="help">
                    A→B na pagaia, 1→2 na referência, sempre no mesmo sentido.
                    Vários fotogramas animam a pagaia.
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
                    {Object.keys(paddle).length}/4 · {deg(paddleAngle(paddle, w, h))}
                    {!inSegment && src && <span className="warn-text"> · fora do trecho</span>}
                  </p>
                  <button
                    className="full"
                    disabled={!paddleKeyHere || busy}
                    onClick={() =>
                      commit({
                        ...p,
                        paddle: p.paddle.filter((k) => Math.abs(k.t - time) > 0.04),
                      })
                    }
                  >
                    <X size={15} />
                    Remover marcas deste fotograma
                  </button>
                </>
              )}
              {inspector === 'tool' && mode === 'target' &&
                (p.targetEnabled ? (
                  <p className="help">
                    Arrasta o esqueleto laranja e compara com o real. É um
                    desenho livre: não respeita o comprimento dos membros.
                  </p>
                ) : (
                  <div className="target-intro">
                    <p>Uma cópia laranja que podes moldar, para comparar.</p>
                    <button
                      className="full"
                      disabled={!corrected || busy}
                      onClick={() => {
                        commit({ ...p, targetEnabled: true });
                        setShowTarget(true);
                      }}
                    >
                      Criar movimento ideal
                    </button>
                    {!corrected && src && (
                      <small className="dim">Precisa de um fotograma detetado.</small>
                    )}
                  </div>
                ))}
              {inspector === 'times' && (
                <StrokeComparison
                  key={src}
                  project={p}
                  disabled={busy || !src}
                  replay={stable.replay}
                />
              )}
              {inspector === 'times' && (
                <div className="notes">
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
              )}
              {inspector === '3d' && (
                <Pose3D project={p} time={time} available={!!src && inSegment && !busy} />
              )}
            </div>
          </aside>
        )}
      </div>
      {src && (
        <Timeline
          key={src}
          project={p}
          busy={busy}
          hasVideo={!!src}
          tracked={tracked}
          flags={reviewFlags}
          bands={bands}
          transitionStart={transitionStart}
          drawings={p.drawings}
          keysOff={drawing.on}
          commit={stable.commit}
          seek={stable.seek}
          replay={stable.replay}
          dragSegment={stable.dragSegment}
          endSegmentEdit={stable.endSegmentEdit}
          markTransition={stable.markTransition}
          cancelTransition={stable.cancelTransition}
          onFlag={stable.onFlag}
          onKey={stable.onKey}
        >
          {transport}
        </Timeline>
      )}
      <Shortcuts open={keysOpen} onOpenChange={setKeysOpen} />
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
