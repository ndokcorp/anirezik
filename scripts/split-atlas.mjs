import sharp from 'sharp';
import path from 'node:path';
const [source, columnsText = '5', rowsText = '2', startText = '7'] = process.argv.slice(2);
if (!source)
  throw new Error(
    'Usage: node scripts/split-atlas.mjs <atlas> [columns] [rows] [first-poster-number]',
  );
const columns = Number(columnsText),
  rows = Number(rowsText),
  start = Number(startText);
if (![columns, rows, start].every((n) => Number.isInteger(n) && n > 0))
  throw new Error('Grid values must be positive integers');
const { width, height } = await sharp(source).metadata();
for (let i = 0; i < columns * rows; i++) {
  const left = Math.round(((i % columns) * width) / columns),
    top = Math.round((Math.floor(i / columns) * height) / rows);
  const right = Math.round((((i % columns) + 1) * width) / columns),
    bottom = Math.round(((Math.floor(i / columns) + 1) * height) / rows);
  await sharp(source)
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize({ width: 500 })
    .webp({ quality: 86 })
    .toFile(path.resolve(`public/assets/poster-${start + i}.webp`));
}
console.log(`Prepared ${columns * rows} poster assets.`);
