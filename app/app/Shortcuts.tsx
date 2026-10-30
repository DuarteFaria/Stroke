'use client';
import { Fragment } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type Row = [keys: string[][], what: string];
/** Cada grupo é uma coisa que se faz; as teclas vêm pela ordem em que se usam. */
const GROUPS: [string, Row[]][] = [
  [
    'Ver o vídeo',
    [
      [[['Espaço']], 'reproduzir ou pausar'],
      [[['←'], ['→']], 'um fotograma'],
      [[['Shift', '←'], ['Shift', '→']], 'um segundo'],
      [[['Home'], ['End']], 'início e fim do trecho'],
      [[['+'], ['−']], 'aproximar e afastar a linha do tempo (ou a roda do rato)'],
      [[['F']], 'apresentar ao atleta (Esc volta)'],
    ],
  ],
  [
    'Marcar pagaiadas',
    [
      [[['1'], ['2']], 'entrada e saída da pá esquerda'],
      [[['3'], ['4']], 'entrada e saída da pá direita'],
      [[['Delete'], ['Backspace']], 'apaga a marcação escolhida (arrasta-a para a mover)'],
      [[['Esc']], 'larga a marcação escolhida'],
    ],
  ],
  [
    'Trecho e esqueleto',
    [
      [[['I'], ['O']], 'o trecho começa ou acaba aqui'],
      [[['G']], 'esqueleto ideal'],
    ],
  ],
  [
    'Desenhar',
    [
      [[['D']], 'abrir ou fechar o desenho'],
      [[['C'], ['M'], ['S'], ['L']], 'caneta, marcador, seta, linha'],
      [[['R'], ['O'], ['T'], ['A']], 'retângulo, círculo, texto, ângulo'],
      [[['P'], ['H'], ['K'], ['B']], 'prumo, foco, laser, borracha'],
      [[['V']], 'selecionar · Delete apaga · Ctrl+D duplica'],
    ],
  ],
  [
    'Projeto',
    [
      [[['Ctrl', 'Z'], ['Ctrl', 'Y']], 'anular e refazer'],
      [[['Ctrl', 'S']], 'guardar'],
      [[['?']], 'esta lista'],
    ],
  ],
];

export default function Shortcuts({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="keys-dialog">
        <DialogTitle>Atalhos do teclado</DialogTitle>
        <DialogDescription>
          Com o desenho aberto, as letras são as ferramentas do desenho.
        </DialogDescription>
        <div className="keys-groups">
          {GROUPS.map(([title, rows]) => (
            <section key={title}>
              <h3>{title}</h3>
              <dl>
                {rows.map(([keys, what]) => (
                  <div key={what}>
                    <dt>
                      {keys.map((combo, i) => (
                        <span key={i}>
                          {i > 0 && '/'}
                          {combo.map((k, j) => (
                            <Fragment key={k}>
                              {j > 0 && '+'}
                              <kbd>{k}</kbd>
                            </Fragment>
                          ))}
                        </span>
                      ))}
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
