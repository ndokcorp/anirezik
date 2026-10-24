import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('public/assets');
await mkdir(root, { recursive: true });
const [logo, hero, atlas] = process.argv.slice(2);
if (!logo || !hero || !atlas)
  throw new Error(
    'Usage: node scripts/prepare-assets.mjs <transparent-logo.png> <hero.png> <3x2-poster-atlas.png>',
  );
await sharp(logo).trim().resize({ width: 1000 }).png().toFile(path.join(root, 'logo.png'));
await sharp(hero)
  .resize({ width: 1920 })
  .webp({ quality: 86 })
  .toFile(path.join(root, 'hero.webp'));
const { width, height } = await sharp(atlas).metadata();
for (let i = 0; i < 6; i++) {
  const left = Math.round(((i % 3) * width) / 3),
    top = Math.round((Math.floor(i / 3) * height) / 2);
  const right = Math.round((((i % 3) + 1) * width) / 3),
    bottom = Math.round(((Math.floor(i / 3) + 1) * height) / 2);
  await sharp(atlas)
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize({ width: 500 })
    .webp({ quality: 86 })
    .toFile(path.join(root, `poster-${i + 1}.webp`));
}
console.log('Logo, hero, and 6 optimized poster illustrations prepared.');
