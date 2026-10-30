let working = false;
const waiting: (() => void)[] = [];
export async function prepare<T>(work: () => Promise<T>): Promise<T> {
  if (!working) working = true; else await new Promise<void>(resolve => waiting.push(resolve));
  try { return await work(); }
  finally { const next = waiting.shift(); if (next) next(); else working = false; }
}
