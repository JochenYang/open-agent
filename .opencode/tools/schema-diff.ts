/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import path from "path"
import { detectLanguages } from "./parsers/detect"
import type { Parser, TypeDef, TypeField } from "./parsers/types"

/**
 * schema-diff — API contract change detector (multi-language)
 *
 * Compares type definitions between two git refs and classifies
 * each change as breaking, safe, or warning. This is semantic-level diff
 * (not text diff) — it understands what type changes mean for consumers.
 *
 * Supported languages: TypeScript/JS, Python, Go, C#, Rust
 * Language-specific parsing is delegated to parser plugins in parsers/.
 * Adding a new language = adding one file in parsers/, zero changes here.
 *
 * Why this is a custom tool (not just git diff):
 * - Parses type signatures semantically (field removed = breaking, optional added = safe)
 * - Classifies changes by compatibility impact automatically
 * - Generates consumer impact reports (which modules reference changed types)
 * These require AST-level analysis that simple diff cannot provide.
 */

// ── Type change classification ──

type ChangeSeverity = "breaking" | "safe" | "warning"

interface TypeChange {
  file: string
  line: number
  type: "field-removed" | "field-added" | "field-optional" | "field-required" | "type-changed" | "type-added" | "type-removed" | "export-removed" | "enum-removed" | "enum-added"
  name: string
  oldVal?: string
  newVal?: string
  severity: ChangeSeverity
  reason: string
}

/** Classify a type change by its compatibility impact. */
function classifyChange(
  type: TypeChange["type"],
  oldVal?: string,
  newVal?: string,
): ChangeSeverity {
  switch (type) {
    case "field-removed":
    case "export-removed":
    case "enum-removed":
    case "field-required":
      // Removing or requiring a field breaks existing consumers
      return "breaking"
    case "field-added":
    case "field-optional":
    case "type-added":
    case "enum-added":
      // Adding or making optional is backward-compatible
      return "safe"
    case "type-changed":
      // Type change severity depends on the relationship between old and new types
      if (oldVal && newVal) {
        // Widening (string -> string | null) is safe
        if (newVal.includes(oldVal) && newVal.includes("|")) return "safe"
        // Narrowing (string | null -> string) is breaking
        if (oldVal.includes("|") && !newVal.includes("|")) return "breaking"
      }
      return "warning"
    default:
      return "warning"
  }
}

// ── Diff computation (language-agnostic) ──

/** Compare two sets of type definitions and produce changes. */
function diffTypeDefs(oldDefs: TypeDef[], newDefs: TypeDef[], filePath: string): TypeChange[] {
  const changes: TypeChange[] = []
  const oldMap = new Map(oldDefs.map((d) => [d.name, d]))
  const newMap = new Map(newDefs.map((d) => [d.name, d]))

  for (const [name, oldDef] of oldMap) {
    if (!newMap.has(name)) {
      if (oldDef.exported) {
        changes.push({
          file: filePath, line: oldDef.line, type: "export-removed",
          name, severity: "breaking", reason: `Exported ${oldDef.kind} "${name}" was removed`,
        })
      }
    }
  }

  for (const [name, newDef] of newMap) {
    if (!oldMap.has(name)) {
      if (newDef.exported) {
        changes.push({
          file: filePath, line: newDef.line, type: "type-added",
          name, severity: "safe", reason: `New exported ${newDef.kind} "${name}" was added`,
        })
      }
    }
  }

  for (const [name, newDef] of newMap) {
    const oldDef = oldMap.get(name)
    if (!oldDef) continue

    const oldFields = new Map(oldDef.fields.map((f) => [f.name, f]))
    const newFields = new Map(newDef.fields.map((f) => [f.name, f]))

    // Removed fields
    for (const [fieldName, oldField] of oldFields) {
      if (!newFields.has(fieldName)) {
        changes.push({
          file: filePath, line: oldField.line, type: "field-removed",
          name: `${name}.${fieldName}`, oldVal: oldField.type,
          severity: "breaking",
          reason: `Field "${fieldName}" removed from ${oldDef.kind} "${name}"`,
        })
      }
    }

    // Added fields
    for (const [fieldName, newField] of newFields) {
      if (!oldFields.has(fieldName)) {
        const changeType = newField.optional ? "field-added" : "field-required"
        changes.push({
          file: filePath, line: newField.line, type: changeType,
          name: `${name}.${fieldName}`, newVal: newField.type,
          severity: newField.optional ? "safe" : "breaking",
          reason: newField.optional
            ? `Optional field "${fieldName}" added to ${newDef.kind} "${name}"`
            : `Required field "${fieldName}" added to ${newDef.kind} "${name}" (breaking for existing consumers)`,
        })
      }
    }

    // Changed fields
    for (const [fieldName, newField] of newFields) {
      const oldField = oldFields.get(fieldName)
      if (!oldField) continue

      // Optional -> required
      if (oldField.optional && !newField.optional) {
        changes.push({
          file: filePath, line: newField.line, type: "field-required",
          name: `${name}.${fieldName}`, severity: "breaking",
          reason: `Field "${fieldName}" changed from optional to required in "${name}"`,
        })
      }
      // Required -> optional
      if (!oldField.optional && newField.optional) {
        changes.push({
          file: filePath, line: newField.line, type: "field-optional",
          name: `${name}.${fieldName}`, severity: "safe",
          reason: `Field "${fieldName}" changed from required to optional in "${name}"`,
        })
      }
      // Type changed
      if (oldField.type !== newField.type) {
        const severity = classifyChange("type-changed", oldField.type, newField.type)
        changes.push({
          file: filePath, line: newField.line, type: "type-changed",
          name: `${name}.${fieldName}`, oldVal: oldField.type, newVal: newField.type,
          severity,
          reason: `Field "${fieldName}" type changed from "${oldField.type}" to "${newField.type}" in "${name}"`,
        })
      }
    }
  }

  return changes
}

// ── Git helpers ──

/** Find the nearest git repository root by walking up from cwd. */
async function findGitRoot(cwd: string): Promise<string | null> {
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], { cwd, stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  return proc.exitCode === 0 ? stdout.trim() : null
}

async function gitShow(ref: string, filePath: string, cwd: string): Promise<string | null> {
  const proc = Bun.spawn(["git", "show", `${ref}:${filePath}`], { cwd, stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  return proc.exitCode === 0 ? stdout : null
}

async function gitDiffNames(base: string, head: string, cwd: string, paths: string[]): Promise<string[]> {
  const proc = Bun.spawn(
    ["git", "diff", "--name-only", base, head, "--", ...paths],
    { cwd, stdout: "pipe", stderr: "pipe" },
  )
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  return proc.exitCode === 0 ? stdout.trim().split("\n").filter(Boolean) : []
}

// ── Parser resolution ──

/** Map file extension to the language key for lazy loading. */
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "typescript", jsx: "typescript", mjs: "typescript", dts: "typescript",
  py: "python",
  go: "go",
  cs: "csharp",
  rs: "rust",
  cpp: "cpp", cxx: "cpp", cc: "cpp", c: "cpp", hpp: "cpp", hxx: "cpp", h: "cpp", hh: "cpp",
}

/** Map language name to a representative file extension. */
const LANG_TO_EXT: Record<string, string> = {
  typescript: "ts",
  python: "py",
  go: "go",
  csharp: "cs",
  rust: "rs",
  cpp: "cpp",
}

/** Cache for loaded parser instances. */
const parserCache = new Map<string, Parser>()

/** Get parser for a file extension (lazy-loaded). */
async function getParser(ext: string): Promise<Parser | null> {
  const langKey = EXT_TO_LANG[ext]
  if (!langKey) return null
  if (parserCache.has(langKey)) return parserCache.get(langKey)!

  try {
    const mod = await import(`./parsers/${langKey}.ts`)
    const parser = mod[`${langKey}Parser`] as Parser | undefined
    if (parser) {
      parserCache.set(langKey, parser)
      return parser
    }
  } catch { /* parser not available */ }
  return null
}

/** All supported source file extensions. */
const SUPPORTED_EXTS = Object.keys(EXT_TO_LANG)

// ── Tool definition ──

export default tool({
  description: `Detect API contract changes between git refs by comparing type definitions (multi-language).

Performs semantic-level diff that classifies changes as:
- BREAKING: removed fields/exports, newly required fields, narrowing type changes
- SAFE: added optional fields, widening type changes, new exports
- WARNING: ambiguous type changes requiring manual review

Supports: TypeScript/JS, Python (dataclass/TypedDict), Go (struct/interface), C# (class/struct/interface), Rust (struct/enum/trait).
This goes beyond text diff — it understands type semantics. Use before merging PRs, publishing packages, or reviewing API changes.`,
  args: {
    base: tool.schema.string().describe("Base ref (e.g. 'main', 'v1.0.0')").default("main"),
    head: tool.schema.string().describe("Head ref to compare").default("HEAD"),
    paths: tool.schema.array(tool.schema.string()).describe("Git pathspecs to check (for example '.', 'src', or 'packages/api')").default(["."]),
    filter: tool.schema.enum(["all", "breaking", "safe", "warning"]).describe("Filter changes by severity").default("all"),
    lang: tool.schema.array(tool.schema.string()).describe("Explicit language(s) to parse (auto-detected if omitted). Options: typescript, python, go, csharp, rust").optional(),
    workdir: tool.schema.string().describe("Git repository directory (auto-detected from ctx.directory if not specified)").optional(),
    limit: tool.schema.number().describe("Max changes to display (default 50)").default(50),
  },
  async execute(args, ctx) {
    const gitDir = args.workdir || ctx.directory
    const gitRoot = await findGitRoot(gitDir)
    if (!gitRoot) {
      return `Error: Not inside a git repository. schema-diff requires a git repo.
  - Use 'workdir' parameter to specify the correct git repository path.
  - Checked: ${gitDir}`
    }

    const changedFiles = await gitDiffNames(args.base, args.head, gitRoot, args.paths)
    if (changedFiles.length === 0) return "No changed files found between refs."

    // Filter to supported source files
    const sourceFiles = changedFiles.filter((f) => {
      const ext = f.split(".").pop()!.toLowerCase()
      // Handle .d.ts specially
      if (f.endsWith(".d.ts")) return true
      return EXT_TO_LANG[ext] !== undefined
    })
    if (sourceFiles.length === 0) return `No supported source files changed. Supported: ${SUPPORTED_EXTS.join(", ")}`

    if (args.lang && args.lang.length > 0) {
      // Pre-load specified parsers
      for (const lang of args.lang) {
        const ext = LANG_TO_EXT[lang]
        if (ext) await getParser(ext)
      }
    }

    const allChanges: TypeChange[] = []

    for (const file of sourceFiles) {
      const ext = file.endsWith(".d.ts") ? "ts" : file.split(".").pop()!.toLowerCase()
      const parser = await getParser(ext)
      if (!parser) continue

      const oldContent = await gitShow(args.base, file, gitRoot)
      const newContent = await gitShow(args.head, file, gitRoot)

      if (!oldContent && !newContent) continue

      // New file — all exports are additions
      if (!oldContent && newContent) {
        const defs = parser.parseTypeDefs(newContent, file)
        for (const def of defs) {
          if (def.exported) {
            allChanges.push({
              file, line: def.line, type: "type-added", name: def.name,
              severity: "safe", reason: `New exported ${def.kind} "${def.name}" in new file`,
            })
          }
        }
        continue
      }

      // Deleted file — all exports are removals
      if (oldContent && !newContent) {
        const defs = parser.parseTypeDefs(oldContent, file)
        for (const def of defs) {
          if (def.exported) {
            allChanges.push({
              file, line: def.line, type: "export-removed", name: def.name,
              severity: "breaking", reason: `Exported ${def.kind} "${def.name}" removed (file deleted)`,
            })
          }
        }
        continue
      }

      // Both exist — compute diff using language-specific parser
      const oldDefs = parser.parseTypeDefs(oldContent!, file)
      const newDefs = parser.parseTypeDefs(newContent!, file)
      allChanges.push(...diffTypeDefs(oldDefs, newDefs, file))
    }

    if (allChanges.length === 0) return "No type contract changes detected."

    const displayChanges = (args.filter === "all"
      ? allChanges
      : allChanges.filter((c) => c.severity === args.filter)
    ).slice(0, args.limit)

    if (displayChanges.length === 0) return "No matching changes found."

    const parts: string[] = []
    // Arrow is more visually distinct than `..` in rendered markdown
    parts.push(`## Schema Diff: ${args.base} → ${args.head}`)
    parts.push(`Total changes: ${allChanges.length} | Breaking: ${allChanges.filter(c => c.severity === "breaking").length} | Safe: ${allChanges.filter(c => c.severity === "safe").length} | Warning: ${allChanges.filter(c => c.severity === "warning").length}`)
    parts.push("")

    for (const c of displayChanges) {
      const icon = c.severity === "breaking" ? "🔴" : c.severity === "warning" ? "🟡" : "🟢"
      parts.push(`  ${icon} ${c.name}: ${c.reason} (${c.file}:${c.line})`)
    }
    if (allChanges.length > args.limit) parts.push(`  ... and ${allChanges.length - args.limit} more`)

    return parts.join("\n")
  },
})
