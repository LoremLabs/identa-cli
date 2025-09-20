import { createReadStream, createWriteStream } from 'fs';

import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';

export async function gzipFile(inputPath, outputPath) {
  const gzip = createGzip();
  const source = createReadStream(inputPath);
  const destination = createWriteStream(outputPath);
  await pipeline(source, gzip, destination);
}
