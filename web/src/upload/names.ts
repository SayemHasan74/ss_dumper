const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
const mimes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };
export function fileMime(file: File): string | null {
  return extensions[file.type] ? file.type : mimes[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
export function uploadName(file: File, index: number, pasted = false): string {
  if (!pasted && file.name && !/^image\.(png|jpe?g|webp|gif)$/i.test(file.name)) return file.name;
  const date = new Date(file.lastModified || Date.now());
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${pasted ? 'pasted' : 'screenshot'}-${stamp}-${pad(index + 1)}.${pasted ? 'png' : extensions[fileMime(file) ?? ''] ?? 'png'}`;
}
