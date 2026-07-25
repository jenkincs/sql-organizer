const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');
const options = {
  entryPoints: ['src/extension.ts', 'src/testing.ts'],
  bundle: true,
  outdir: 'dist',
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  target: 'node20',
};
async function main() {
  if (watch) await esbuild.context(options).then((ctx) => ctx.watch());
  else await esbuild.build(options);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
