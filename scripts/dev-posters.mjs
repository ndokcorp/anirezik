import { spawn } from 'node:child_process';
const child = spawn(
  process.execPath,
  ['node_modules/astro/bin/astro.mjs', 'dev', '--host', '127.0.0.1', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, ANIREZIK_EXPERIMENTAL_SHIKIMORI_POSTERS: '1' },
  },
);
child.on('exit', (code) => (process.exitCode = code ?? 1));
