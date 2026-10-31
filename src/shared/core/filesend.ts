// Sending a file: the content is split into pieces that go out one after
// another with a pause in between, so slow devices can keep up.

export type FileSendMode = 'blocks' | 'lines';

/** Largest file the application sends (it is held in memory completely). */
export const MAX_SEND_FILE_BYTES = 16 * 1024 * 1024;

/**
 * blocks – fixed-size pieces of `blockSize` bytes.
 * lines  – one piece per line, the line end (LF) included; a line longer than
 *          `blockSize` is split further, so no piece exceeds the block size.
 */
export function splitForSending(
  data: Uint8Array,
  mode: FileSendMode,
  blockSize: number,
): Uint8Array[] {
  const size = Math.max(1, Math.floor(blockSize));
  const pieces: Uint8Array[] = [];
  const pushBlocks = (from: number, to: number): void => {
    for (let pos = from; pos < to; pos += size)
      pieces.push(data.subarray(pos, Math.min(pos + size, to)));
  };
  if (mode === 'blocks') {
    pushBlocks(0, data.length);
    return pieces;
  }
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0a) {
      pushBlocks(start, i + 1);
      start = i + 1;
    }
  }
  pushBlocks(start, data.length);
  return pieces;
}

/** Seconds the transfer needs at least: time on the wire plus the pauses. */
export function estimateSeconds(
  bytes: number,
  pieces: number,
  baudRate: number,
  pauseMs: number,
): number {
  const bitsPerByte = 10; // start + 8 data + stop
  return (bytes * bitsPerByte) / Math.max(1, baudRate) + (Math.max(0, pieces - 1) * pauseMs) / 1000;
}
