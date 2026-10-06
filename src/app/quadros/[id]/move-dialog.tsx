"use client";

import { useEffect, useRef, useState } from "react";
import { buttonStyles } from "@/components/button-styles";
import { cardsOf, sortedColumns, type BoardState, type Card } from "@/lib/board-state";

/** Alternativa acessível ao arrastar e soltar (teclado, leitores de tela e telas de toque). */
export function MoveDialog(props: {
  card: Card;
  state: BoardState;
  onClose: () => void;
  onMove: (columnId: string, afterId: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [columnId, setColumnId] = useState(props.card.column_id);
  const others = cardsOf(props.state, columnId).filter((c) => c.id !== props.card.id);
  const [after, setAfter] = useState<string>("__fim__");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const select = "min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-base";
  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      aria-labelledby="mover-titulo"
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-xl border border-border bg-surface p-5 text-foreground backdrop:bg-black/50"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const afterId = after === "__topo__" ? null : after === "__fim__" ? (others.at(-1)?.id ?? null) : after;
          props.onMove(columnId, afterId);
        }}
      >
        <h2 id="mover-titulo" className="text-lg font-semibold">Mover “{props.card.title}”</h2>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Coluna
          <select
            value={columnId}
            onChange={(e) => {
              setColumnId(e.target.value);
              setAfter("__fim__");
            }}
            className={select}
          >
            {sortedColumns(props.state).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Posição
          <select value={after} onChange={(e) => setAfter(e.target.value)} className={select}>
            <option value="__topo__">No topo</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>Depois de “{c.title.slice(0, 50)}”</option>
            ))}
            <option value="__fim__">No fim</option>
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonStyles.secondary} onClick={() => ref.current?.close()}>Cancelar</button>
          <button type="submit" className={buttonStyles.primary}>Mover</button>
        </div>
      </form>
    </dialog>
  );
}
