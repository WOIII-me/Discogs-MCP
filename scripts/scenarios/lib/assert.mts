/**
 * Tiny assertion DSL for scenario files. Paths are dot paths with `[n]` and
 * `[*]` (wildcard, fan-out) segments, e.g. `data.topPressings[*].signals`.
 */
export type Op =
  | "eq" | "neq" | "gte" | "lte" | "gt" | "lt"
  | "exists" | "absent" | "truthy" | "falsy"
  | "includes" | "matches" | "notMatches"
  | "lengthGte" | "lengthLte" | "lengthEq"
  | "every" | "some" | "none";

export interface Assertion {
  path: string;
  op: Op;
  value?: unknown;
  /** Compare against another path in the same result instead of a literal `value`. */
  valuePath?: string;
  /** For every / some / none: an assertion evaluated against each element (path relative to the element). */
  each?: Assertion;
  /** Human label in the report. */
  label?: string;
}

export function resolve(root: unknown, path: string): unknown[] {
  if (!path || path === "$") return [root];
  const segs = path.replace(/\[(\d+|\*)\]/g, ".[$1]").split(".").filter(Boolean);
  let cur: unknown[] = [root];
  for (const seg of segs) {
    const next: unknown[] = [];
    for (const c of cur) {
      if (c === null || c === undefined) continue;
      if (seg === "[*]") {
        if (Array.isArray(c)) next.push(...c);
      } else if (/^\[\d+\]$/.test(seg)) {
        if (Array.isArray(c)) next.push(c[Number(seg.slice(1, -1))]);
      } else if (typeof c === "object") {
        next.push((c as Record<string, unknown>)[seg]);
      }
    }
    cur = next;
  }
  return cur;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function check(root: unknown, a: Assertion): { ok: boolean; detail: string } {
  if (a.valuePath !== undefined) a = { ...a, value: resolve(root, a.valuePath)[0] };
  const vals = resolve(root, a.path);
  const fanned = a.path.includes("[*]");
  const single = fanned ? vals : vals[0];
  const show = (v: unknown) => str(v).slice(0, 120);
  switch (a.op) {
    case "exists": return { ok: vals.some((v) => v !== undefined), detail: `found ${vals.filter((v) => v !== undefined).length}` };
    case "absent": return { ok: vals.every((v) => v === undefined), detail: `found ${vals.filter((v) => v !== undefined).length}` };
    case "truthy": return { ok: Boolean(single), detail: show(single) };
    case "falsy": return { ok: !single, detail: show(single) };
    case "eq": return { ok: JSON.stringify(single) === JSON.stringify(a.value), detail: `${show(single)} vs ${show(a.value)}` };
    case "neq": return { ok: JSON.stringify(single) !== JSON.stringify(a.value), detail: show(single) };
    case "gte": return { ok: Number(single) >= Number(a.value), detail: `${show(single)} ≥ ${show(a.value)}` };
    case "lte": return { ok: Number(single) <= Number(a.value), detail: `${show(single)} ≤ ${show(a.value)}` };
    case "gt": return { ok: Number(single) > Number(a.value), detail: `${show(single)} > ${show(a.value)}` };
    case "lt": return { ok: Number(single) < Number(a.value), detail: `${show(single)} < ${show(a.value)}` };
    case "includes": {
      const hay = fanned ? vals : single;
      const ok = Array.isArray(hay) ? hay.some((h) => JSON.stringify(h) === JSON.stringify(a.value) || (typeof h === "string" && typeof a.value === "string" && h.includes(a.value))) : typeof hay === "string" && hay.includes(String(a.value));
      return { ok, detail: show(hay) };
    }
    case "matches": { const re = new RegExp(String(a.value), "i"); const hay = fanned ? vals.map(str).join("\n") : str(single); return { ok: re.test(hay), detail: hay.slice(0, 120) }; }
    case "notMatches": { const re = new RegExp(String(a.value), "i"); const hay = fanned ? vals.map(str).join("\n") : str(single); return { ok: !re.test(hay), detail: hay.slice(0, 120) }; }
    case "lengthGte": { const n = Array.isArray(single) ? single.length : fanned ? vals.length : String(single ?? "").length; return { ok: n >= Number(a.value), detail: `length ${n}` }; }
    case "lengthLte": { const n = Array.isArray(single) ? single.length : fanned ? vals.length : String(single ?? "").length; return { ok: n <= Number(a.value), detail: `length ${n}` }; }
    case "lengthEq": { const n = Array.isArray(single) ? single.length : fanned ? vals.length : String(single ?? "").length; return { ok: n === Number(a.value), detail: `length ${n}` }; }
    case "every": case "some": case "none": {
      const arr = fanned ? vals : Array.isArray(single) ? single : [];
      if (!a.each) return { ok: false, detail: "missing `each`" };
      const results = arr.map((el) => check(el, a.each!).ok);
      const passed = results.filter(Boolean).length;
      const ok = a.op === "every" ? passed === arr.length && arr.length > 0 : a.op === "some" ? passed > 0 : passed === 0;
      return { ok, detail: `${passed}/${arr.length} elements` };
    }
  }
}
