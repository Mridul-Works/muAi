import type { FileMap } from "@/lib/fs/virtual-fs";

export interface Template {
  id: string;
  label: string;
  /** Sandpack template the bundler runs under. */
  sandpackTemplate: "vite-react-ts" | "react-ts" | "static";
  /** File Sandpack opens by default in the code view. */
  entry: string;
  files: FileMap;
  /**
   * Injected verbatim into the system prompt. Describes the conventions and
   * component inventory the model is expected to compose from.
   *
   * This is the quality ceiling: whatever isn't described here, the model
   * invents. When a real design system lands, most of the work is expanding
   * this string and the files above.
   */
  promptFragment: string;
}
