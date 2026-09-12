"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog, type ConfirmDialogState } from "@/components/ui/confirm-dialog";

/** Renders a themed confirm dialog in place of window.confirm(). Usage:
 * const { confirm, dialog } = useConfirm();
 * confirm({ title: "...", description: "...", onConfirm: () => doThing() });
 * return <>{dialog}...</>; */
export function useConfirm() {
  const [state, setState] = useState<ConfirmDialogState | null>(null);
  const confirm = useCallback((next: ConfirmDialogState) => setState(next), []);
  const dialog = <ConfirmDialog state={state} onClose={() => setState(null)} />;
  return { confirm, dialog };
}
