/**
 * Env parsing that cannot brick the app. Number("") is 0 and Number("abc")
 * is NaN — either one flowing into a loop bound or retry count silently
 * disables the agent. Out-of-range or unparsable values fall back.
 */
export function envInt(
  name: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Optional float: undefined when unset or set to "none"/"off" (meaning: omit
 * the parameter from requests entirely), fallback when unparsable.
 */
export function envFloatOrOff(
  name: string,
  fallback: number | undefined,
  { min, max }: { min: number; max: number },
): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (["none", "off"].includes(raw.trim().toLowerCase())) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
