import { VirtualFS, normalizePath } from "@/lib/fs/virtual-fs";
import type { ToolSchema } from "@/lib/ai/types";

export interface ToolOutcome {
  /** Text returned to the model. */
  content: string;
  ok: boolean;
  /** Short human-readable line for the UI. */
  summary: string;
  /** Set when the tool touched a file, so the UI can highlight it. */
  path?: string;
}

const str = (description: string) => ({ type: "string", description });

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "list_files",
    description:
      "List every file in the project with its line count. Cheap — call it when unsure what exists.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_file",
    description:
      "Read a file's full contents. You MUST read a file before editing it.",
    parameters: {
      type: "object",
      properties: { path: str("Path such as /src/App.tsx") },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Create a file, or overwrite one completely. Use for new files and for rewrites of small files. For a targeted change to a large file, prefer edit_file.",
    parameters: {
      type: "object",
      properties: {
        path: str("Path such as /src/components/Header.tsx"),
        content: str("The complete file contents. Never truncate or abbreviate."),
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace an exact snippet in an existing file. old_string must appear EXACTLY once, including whitespace. Cheaper and safer than rewriting a large file.",
    parameters: {
      type: "object",
      properties: {
        path: str("Path of the file to edit"),
        old_string: str("Exact text to find. Include enough context to be unique."),
        new_string: str("Text to replace it with"),
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the project.",
    parameters: {
      type: "object",
      properties: { path: str("Path to delete") },
      required: ["path"],
    },
  },
  {
    name: "rename_file",
    description:
      "Move or rename a file. Remember to update imports that referenced the old path.",
    parameters: {
      type: "object",
      properties: { from: str("Current path"), to: str("New path") },
      required: ["from", "to"],
    },
  },
  {
    name: "search_files",
    description:
      "Case-insensitive substring search across the project. Returns matching paths and line numbers.",
    parameters: {
      type: "object",
      properties: { query: str("Text to search for") },
      required: ["query"],
    },
  },
  {
    name: "add_dependency",
    description:
      "Add an npm package to package.json so it can be imported. Required before importing any package other than react/react-dom.",
    parameters: {
      type: "object",
      properties: {
        name: str("Package name, e.g. recharts"),
        version: str("Semver range such as ^2.13.0. Use latest if unsure."),
      },
      required: ["name", "version"],
    },
  },
];

type Args = Record<string, unknown>;

function fail(message: string): ToolOutcome {
  return { ok: false, summary: message, content: `Error: ${message}` };
}

/**
 * Strict argument accessor. Coercing a missing or mistyped argument to ""
 * is how files get silently emptied — a write_file whose content arrived as
 * a number would "succeed" with zero bytes. Wrong type must be a tool error
 * the model sees and corrects.
 */
function reqString(args: Args, key: string): string | null {
  const v = args[key];
  return typeof v === "string" ? v : null;
}

/** Resolve and validate a path argument; returns a fail outcome on bad input. */
function reqPath(args: Args, key = "path"): { path: string } | { error: ToolOutcome } {
  const raw = reqString(args, key);
  if (raw === null) return { error: fail(`Missing or non-string "${key}" argument.`) };
  const path = normalizePath(raw);
  if (!path) return { error: fail(`"${raw}" is not a valid file path.`) };
  return { path };
}

/** read_file guard: a pathological file must not detonate the context. */
const MAX_READ_CHARS = 48_000;

export function executeTool(fs: VirtualFS, name: string, args: Args): ToolOutcome {
  switch (name) {
    case "list_files":
      return { ok: true, content: fs.tree(), summary: "Listed project files" };

    case "read_file": {
      const p = reqPath(args);
      if ("error" in p) return p.error;
      const content = fs.read(p.path);
      if (content === null) {
        return {
          ok: false,
          path: p.path,
          summary: `File not found: ${p.path}`,
          content: `Error: ${p.path} does not exist.\n\nProject files:\n${fs.tree()}`,
        };
      }
      if (content.length > MAX_READ_CHARS) {
        return {
          ok: true,
          path: p.path,
          summary: `Read ${p.path} (truncated)`,
          content:
            content.slice(0, MAX_READ_CHARS) +
            `\n\n[TRUNCATED: file is ${content.length} characters. ` +
            `Use search_files to locate what you need, or rewrite the file smaller.]`,
        };
      }
      return { ok: true, path: p.path, summary: `Read ${p.path}`, content };
    }

    case "write_file": {
      const p = reqPath(args);
      if ("error" in p) return p.error;
      const content = reqString(args, "content");
      if (content === null) {
        return fail(
          `write_file for ${p.path} arrived without a string "content" argument. ` +
            `Nothing was written. Re-issue the call with the full file contents.`,
        );
      }
      const existed = fs.exists(p.path);
      fs.write(p.path, content);
      const lines = content.split("\n").length;
      return {
        ok: true,
        path: p.path,
        summary: `${existed ? "Updated" : "Created"} ${p.path}`,
        content: `${existed ? "Overwrote" : "Created"} ${p.path} (${lines} lines).`,
      };
    }

    case "edit_file": {
      const p = reqPath(args);
      if ("error" in p) return p.error;
      const oldString = reqString(args, "old_string");
      const newString = reqString(args, "new_string");
      if (oldString === null || newString === null) {
        return fail("edit_file requires string old_string and new_string arguments.");
      }
      if (oldString === "") {
        return fail("old_string must not be empty. Use write_file to create content.");
      }
      const current = fs.read(p.path);
      if (current === null) {
        return {
          ok: false,
          path: p.path,
          summary: `File not found: ${p.path}`,
          content: `Error: ${p.path} does not exist. Use write_file to create it.`,
        };
      }
      const occurrences = current.split(oldString).length - 1;
      if (occurrences === 0) {
        return {
          ok: false,
          path: p.path,
          summary: `No match in ${p.path}`,
          content:
            `Error: old_string was not found in ${p.path}. It must match exactly, ` +
            `including indentation. Re-read the file and try again.`,
        };
      }
      if (occurrences > 1) {
        return {
          ok: false,
          path: p.path,
          summary: `Ambiguous edit in ${p.path}`,
          content:
            `Error: old_string appears ${occurrences} times in ${p.path}. ` +
            `Include more surrounding context so it matches exactly once.`,
        };
      }
      // split/join, NOT String.replace with a string replacement: replace()
      // applies $-substitution ($$, $&, $') to the replacement text, which
      // silently corrupts generated code like `$${price}` templates.
      fs.write(p.path, current.split(oldString).join(newString));
      return { ok: true, path: p.path, summary: `Edited ${p.path}`, content: `Edited ${p.path}.` };
    }

    case "delete_file": {
      const p = reqPath(args);
      if ("error" in p) return p.error;
      return fs.delete(p.path)
        ? { ok: true, path: p.path, summary: `Deleted ${p.path}`, content: `Deleted ${p.path}.` }
        : {
            ok: false,
            path: p.path,
            summary: `Not found: ${p.path}`,
            content: `Error: ${p.path} does not exist.`,
          };
    }

    case "rename_file": {
      const from = reqPath(args, "from");
      if ("error" in from) return from.error;
      const to = reqPath(args, "to");
      if ("error" in to) return to.error;
      return fs.rename(from.path, to.path)
        ? {
            ok: true,
            path: to.path,
            summary: `Renamed ${from.path} to ${to.path}`,
            content: `Renamed ${from.path} to ${to.path}.`,
          }
        : {
            ok: false,
            summary: `Not found: ${from.path}`,
            content: `Error: ${from.path} does not exist.`,
          };
    }

    case "search_files": {
      const query = reqString(args, "query");
      if (query === null || query === "") {
        return fail("search_files requires a non-empty string query.");
      }
      const hits = fs.search(query);
      if (!hits.length) {
        return {
          ok: true,
          summary: `No matches for "${query}"`,
          content: `No matches for "${query}".`,
        };
      }
      return {
        ok: true,
        summary: `${hits.length} matches for "${query}"`,
        content: hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n"),
      };
    }

    case "add_dependency": {
      const pkg = reqString(args, "name");
      if (pkg === null || pkg === "") {
        return fail("add_dependency requires a package name.");
      }
      const version = reqString(args, "version") || "latest";
      const raw = fs.read("/package.json");
      if (raw === null) return fail("package.json is missing from the project.");

      let parsed: { dependencies?: Record<string, string> } & Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return fail("package.json is not valid JSON.");
      }
      parsed.dependencies = { ...(parsed.dependencies ?? {}), [pkg]: version };
      fs.write("/package.json", JSON.stringify(parsed, null, 2) + "\n");
      return {
        ok: true,
        path: "/package.json",
        summary: `Added ${pkg}@${version}`,
        content: `Added ${pkg}@${version} to dependencies.`,
      };
    }

    default:
      return fail(`Unknown tool "${name}".`);
  }
}
