export type FileMap = Record<string, string>;

export type Mutation =
  | { kind: "write"; path: string; content: string }
  | { kind: "delete"; path: string };

/**
 * Sandpack keys files by absolute-from-root path, so normalise to that.
 * Resolves "."/".." segments and collapses duplicate slashes so one file
 * cannot exist under several aliased keys ("/src/../src/App.tsx",
 * "src//App.tsx", "src\\App.tsx" all become "/src/App.tsx").
 * Returns "" for input that resolves to nothing — callers must reject that.
 */
export function normalizePath(path: string): string {
  const unified = path.trim().split("\\").join("/");
  const resolved: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  if (!resolved.length) return "";
  return "/" + resolved.join("/");
}

export class VirtualFS {
  private files: FileMap;
  readonly mutations: Mutation[] = [];

  constructor(files: FileMap = {}) {
    this.files = {};
    for (const [p, c] of Object.entries(files)) {
      this.files[normalizePath(p)] = c;
    }
  }

  exists(path: string) {
    return normalizePath(path) in this.files;
  }

  read(path: string): string | null {
    return this.files[normalizePath(path)] ?? null;
  }

  write(path: string, content: string) {
    const p = normalizePath(path);
    this.files[p] = content;
    this.mutations.push({ kind: "write", path: p, content });
  }

  delete(path: string): boolean {
    const p = normalizePath(path);
    if (!(p in this.files)) return false;
    delete this.files[p];
    this.mutations.push({ kind: "delete", path: p });
    return true;
  }

  rename(from: string, to: string): boolean {
    const content = this.read(from);
    if (content === null) return false;
    this.delete(from);
    this.write(to, content);
    return true;
  }

  list(): string[] {
    return Object.keys(this.files).sort();
  }

  snapshot(): FileMap {
    return { ...this.files };
  }

  /** Compact listing for the system prompt: paths + size, never contents. */
  tree(): string {
    const paths = this.list();
    if (!paths.length) return "(empty project)";
    return paths
      .map((p) => {
        const lines = this.files[p].split("\n").length;
        return `${p} (${lines} lines)`;
      })
      .join("\n");
  }

  search(query: string, maxResults = 40) {
    const results: { path: string; line: number; text: string }[] = [];
    const needle = query.toLowerCase();
    for (const path of this.list()) {
      const lines = this.files[path].split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          results.push({ path, line: i + 1, text: lines[i].trim().slice(0, 200) });
          if (results.length >= maxResults) return results;
        }
      }
    }
    return results;
  }
}
