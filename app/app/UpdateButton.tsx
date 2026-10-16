'use client';
import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { desktop, type DesktopUpdate } from '@/lib/desktop';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Progress } from '@/components/ui/progress';

const mb = (bytes: number) => Math.round(bytes / 1024 ** 2);

function Ring({ percent }: { percent: number }) {
  const r = 6, length = 2 * Math.PI * r;
  return (
    <svg className="update-ring" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r={r} />
      <circle cx="8" cy="8" r={r} strokeDasharray={length} strokeDashoffset={length * (1 - percent / 100)} />
    </svg>
  );
}

/* Hidden until a download starts: checking and "already up to date" say nothing. */
export default function UpdateButton() {
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);
  const [version, setVersion] = useState('');
  useEffect(() => {
    if (!desktop()) return;
    void desktop()!.config().then(c => {
      setVersion(c.version);
      setUpdate(c.update);
    });
    return desktop()!.onUpdate(setUpdate);
  }, []);
  if (!update) return null;
  const { state, percent } = update;
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={150}
        render={
          <button
            className="update"
            data-state={state}
            onClick={
              state === 'ready' ? () => desktop()!.installUpdate()
              : state === 'error' ? () => desktop()!.retryUpdate()
              : undefined
            }
          >
            {state === 'downloading' && (
              <>
                <Ring percent={percent} />
                A atualizar
                <span className="update-percent">{percent}%</span>
              </>
            )}
            {state === 'ready' && (
              <>
                <i />
                Reiniciar para atualizar
              </>
            )}
            {state === 'error' && (
              <>
                <RotateCw size={14} />
                Atualização falhou · tentar de novo
              </>
            )}
          </button>
        }
      />
      <HoverCardContent align="end" sideOffset={8} className="w-78 p-3.5 text-[12.5px]">
        <div className="flex items-baseline justify-between gap-3 font-semibold">
          {state === 'ready' ? `Stroke ${update.version} está pronto` : `Stroke ${update.version}`}
          <span className="text-[11.5px] font-normal text-(--faint)">tens a {version}</span>
        </div>
        <p className="mt-0.5 text-xs text-(--muted)">
          {state === 'downloading' && `A transferir em segundo plano · ${mb(update.transferred)} de ${mb(update.total)} MB`}
          {state === 'ready' && 'Reinicia agora ou instala-se quando fechares.'}
          {state === 'error' && 'A transferência parou. Tenta de novo, ou o Stroke tenta sozinho na próxima abertura.'}
        </p>
        {state === 'downloading' && <Progress value={percent} className="mt-2" />}
        {update.notes.length > 0 && (
          <>
            <div className="mt-3 mb-1 text-[11px] tracking-wide text-(--faint)">NOVIDADES</div>
            <ul className="list-disc space-y-0.5 pl-4 leading-normal marker:text-(--faint)">
              {update.notes.map(note => <li key={note}>{note}</li>)}
            </ul>
          </>
        )}
        <p className="mt-3 border-t border-(--line) pt-2 text-[11.5px] text-(--faint)">
          {state === 'ready' ? 'Se houver alterações por guardar, o Stroke pergunta antes.' : 'Podes continuar a trabalhar.'}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
