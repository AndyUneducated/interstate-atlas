// Writing into data/ on Windows.
//
// After a burst of writes, opening a file to truncate it can fail for a while
// with UNKNOWN or EBUSY: something - an editor, an indexer, a virus scanner -
// is reading what was just written. Failing there throws away a build that may
// have taken half an hour. So the text goes to a file beside the target and is
// renamed over it, which a reader does not block, and the rename is retried
// with a growing pause.

import { writeFile, rename } from 'node:fs/promises';

const TRANSIENT = new Set(['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES']);

export async function writeOut(path, text) {
  const tmp = `${path}.tmp`;
  for (let attempt = 1; ; attempt++) {
    try {
      await writeFile(tmp, text);
      return await rename(tmp, path);
    } catch (e) {
      if (attempt >= 10 || !TRANSIENT.has(e.code)) throw e;
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}
