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
function blockLength(blockSize: number): number {
  if (!Number.isFinite(blockSize) || blockSize < 1) throw new RangeError('Invalid block size');
  return Math.floor(blockSize);
}

/** Generates one view at a time: a 16 MiB file with 1-byte blocks must not allocate 16M views. */
export function* sendPieces(
  data: Uint8Array,
  mode: FileSendMode,
  blockSize: number,
): Generator<Uint8Array> {
  const size = blockLength(blockSize);
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    if (i - start + 1 === size || (mode === 'lines' && data[i] === 0x0a)) {
      yield data.subarray(start, i + 1);
      start = i + 1;
    }
  }
  if (start < data.length) yield data.subarray(start);
}

/** Counts pieces for the preview without allocating any per-piece arrays. */
export function countSendPieces(data: Uint8Array, mode: FileSendMode, blockSize: number): number {
  const size = blockLength(blockSize);
  if (mode === 'blocks') return Math.ceil(data.length / size);
  let count = 0;
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0a) {
      count += Math.ceil((i + 1 - start) / size);
      start = i + 1;
    }
  }
  return count + Math.ceil((data.length - start) / size);
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
