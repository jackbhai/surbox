import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.jsx$/.test(f)) files.push(p);
  }
};
walk('src');

let issues = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const comps = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(?:export\s+)?function\s+([A-Z]\w*)|^const\s+([A-Z]\w*)\s*=\s*[({]/);
    if (m) comps.push({ name: m[1] || m[2], start: i });
  });
  comps.push({ name: '__eof__', start: lines.length });

  for (let c = 0; c < comps.length - 1; c++) {
    const { name, start } = comps[c];
    const end = comps[c + 1].start;
    let depth = 0, earlyReturnLine = -1;

    const lineDepth = (l) => {
      let d = 0;
      for (const ch of l) { if (ch === '{') d++; else if (ch === '}') d--; }
      return d;
    };

    for (let i = start; i < end; i++) {
      const l = lines[i];
      const dd = lineDepth(l);
      // depth BEFORE this line's own closing braces: compute pre-depth
      let pre = depth;
      // component-body top level = depth 1 (function body opened)
      if (earlyReturnLine < 0 && pre === 1 && /^\s*return\b/.test(l) && !/^\s*\/\//.test(l) && i > start) {
        earlyReturnLine = i;
      }
      // hook at component top level AFTER the early return
      if (earlyReturnLine >= 0 && pre === 1 && i > earlyReturnLine &&
          /\b(use[A-Z]\w*)\s*\(/.test(l) && !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)) {
        console.log(`✗ ${file}: <${name}> hook "${l.trim().slice(0, 60)}" at line ${i + 1}, AFTER component early return (line ${earlyReturnLine + 1})`);
        issues++;
      }
      depth += dd;
    }
  }
}
console.log(issues === 0 ? '✅ HOOK AUDIT CLEAN — no top-level hook after a component early return' : `${issues} genuine hook-order issue(s)`);
