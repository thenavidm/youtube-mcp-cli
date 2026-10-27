/**
 * What a video file is, read from its own header: the size it plays at and how
 * long it runs.
 *
 * An MP4 or MOV keeps both in its `moov` box: the movie header (`mvhd`) has the
 * duration, and each track header (`tkhd`) has the size the track is shown at
 * and a matrix that rotates it. A phone filming upright usually stores
 * 1920x1080 frames with a 90 degree turn, so the stored size alone calls a
 * vertical video horizontal. The matrix decides.
 *
 * Only box headers and the `moov` box are read, never the media data, so a
 * multi-gigabyte file costs a few small reads. Anything that is not an MP4 or
 * MOV, or is malformed, returns undefined and the caller carries on without it.
 */

import { open } from "node:fs/promises";

export type VideoShape = {
  /** As shown, after the track's rotation. */
  width: number;
  height: number;
  /** Undefined when the movie header carries no usable duration. */
  durationSeconds?: number;
};

/** Read `length` bytes at `offset`. Fewer come back at the end of the file. */
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

/** The `moov` box of a normal file is a few hundred kilobytes; this stops a corrupt length from reading the whole file. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

type Box = { type: string; start: number; headerSize: number; size: number };

/** Walk the boxes in `[from, to)` of a buffer. */
function* boxes(bytes: Uint8Array, from: number, to: number): Generator<Box> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = from;
  while (offset + 8 <= to) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > to) return;
      size = Number(view.getBigUint64(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < headerSize || offset + size > to) return;
    yield { type, start: offset, headerSize, size };
    offset += size;
  }
}

function child(bytes: Uint8Array, parent: Box, type: string): Box | undefined {
  for (const box of boxes(bytes, parent.start + parent.headerSize, parent.start + parent.size)) {
    if (box.type === type) return box;
  }
  return undefined;
}

/** Find the top-level `moov` box by reading headers only, and return its bytes. */
async function readMoov(read: ReadAt, fileSize: number): Promise<Uint8Array | undefined> {
  let offset = 0;
  while (offset + 8 <= fileSize) {
    const head = await read(offset, 16);
    if (head.byteLength < 8) return undefined;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0);
    const type = String.fromCharCode(head[4]!, head[5]!, head[6]!, head[7]!);
    if (size === 1) {
      if (head.byteLength < 16) return undefined;
      size = Number(view.getBigUint64(8));
    } else if (size === 0) {
      size = fileSize - offset;
    }
    if (size < 8) return undefined;
    // The first box of an MP4 or MOV is one of these. Anything else is another format.
    if (offset === 0 && !["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(type)) return undefined;
    if (type === "moov") {
      if (size > MAX_MOOV_BYTES) return undefined;
      const moov = await read(offset, size);
      return moov.byteLength === size ? moov : undefined;
    }
    offset += size;
  }
  return undefined;
}

/** Fixed-point 16.16 to a number. */
const fixed = (view: DataView, at: number): number => view.getInt32(at) / 65536;

/** The shape of an MP4 or MOV, from any random-access reader. */
export async function probeVideo(read: ReadAt, fileSize: number): Promise<VideoShape | undefined> {
  try {
    const moov = await readMoov(read, fileSize);
    if (!moov) return undefined;
    const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
    const root: Box = { type: "moov", start: 0, headerSize: view.getUint32(0) === 1 ? 16 : 8, size: moov.byteLength };

    let durationSeconds: number | undefined;
    const mvhd = child(moov, root, "mvhd");
    if (mvhd) {
      const at = mvhd.start + mvhd.headerSize;
      const version = moov[at];
      const timescale = version === 1 ? view.getUint32(at + 20) : view.getUint32(at + 12);
      const duration = version === 1 ? Number(view.getBigUint64(at + 24)) : view.getUint32(at + 16);
      if (timescale > 0 && duration > 0 && duration !== 0xffffffff) durationSeconds = duration / timescale;
    }

    for (const trak of boxes(moov, root.start + root.headerSize, root.size)) {
      if (trak.type !== "trak") continue;
      const mdia = child(moov, trak, "mdia");
      const hdlr = mdia ? child(moov, mdia, "hdlr") : undefined;
      if (!hdlr) continue;
      const handlerAt = hdlr.start + hdlr.headerSize + 8;
      if (String.fromCharCode(moov[handlerAt]!, moov[handlerAt + 1]!, moov[handlerAt + 2]!, moov[handlerAt + 3]!) !== "vide") continue;

      const tkhd = child(moov, trak, "tkhd");
      if (!tkhd) continue;
      const at = tkhd.start + tkhd.headerSize;
      const matrixAt = at + (moov[at] === 1 ? 52 : 40);
      const width = Math.round(fixed(view, matrixAt + 36));
      const height = Math.round(fixed(view, matrixAt + 40));
      if (width <= 0 || height <= 0) continue;
      // A quarter turn either way leaves a and d at zero: the shown frame swaps width and height.
      const a = fixed(view, matrixAt);
      const d = fixed(view, matrixAt + 16);
      const turned = Math.abs(a) < 0.5 && Math.abs(d) < 0.5;
      return { width: turned ? height : width, height: turned ? width : height, ...(durationSeconds ? { durationSeconds } : {}) };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** The shape of a video file on disk. */
export async function probeVideoFile(path: string, fileSize: number): Promise<VideoShape | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const fh = handle;
    return await probeVideo(async (offset, length) => {
      const buffer = Buffer.alloc(Math.max(0, Math.min(length, fileSize - offset)));
      const { bytesRead } = await fh.read(buffer, 0, buffer.byteLength, offset);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    }, fileSize);
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** The shape of a video already in memory. */
export function probeVideoBytes(bytes: Uint8Array): Promise<VideoShape | undefined> {
  return probeVideo(async (offset, length) => bytes.subarray(offset, offset + length), bytes.byteLength);
}
