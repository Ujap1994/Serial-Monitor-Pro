// HEX formatting for every data field that accepts HEX input.

import type { ChangeEvent } from 'react';
import { formatHexInput } from '@shared/core/format';
import { useStore } from '../lib/store';
import { appStore } from '../state/app';

/**
 * Change handler for data fields: in HEX format the input is formatted while
 * typing (upper case and grouping as set in the settings), the caret stays at
 * the same digit. Other formats pass the text through unchanged.
 */
export function useHexChange(): (
  format: string,
  apply: (text: string) => void,
) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void {
  const s = useStore(appStore, (st) => st.settings);
  return (format, apply) => (e) => {
    const el = e.target;
    if (format !== 'HEX') {
      apply(el.value);
      return;
    }
    const out = formatHexInput(el.value, el.selectionStart ?? -1, {
      uppercase: s.hexUppercase,
      group: s.hexGroup,
      groupSize: s.hexGroupSize,
    });
    apply(out.text);
    requestAnimationFrame(() => {
      if (document.activeElement === el) el.setSelectionRange(out.cursor, out.cursor);
    });
  };
}
