import { tool } from "@opencode-ai/plugin"
import { execFile, execFileSync } from "child_process"
import { promisify } from "util"
import fs from "fs"
import path from "path"

const exec = promisify(execFile)

// ── Language mapping (ast-grep CLI native names) ──
const LANG_ALIASES: Record<string, string> = {
  typescript: "typescript",
  ts: "typescript",
  tsx: "tsx",
  javascript: "javascript",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  python: "python",
  rust: "rust",
  rs: "rust",
  go: "go",
  golang: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "csharp",
  cs: "csharp",
  css: "css",
  html: "html",
  bash: "bash",
  sh: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  swift: "swift",
  kotlin: "kotlin",
  scala: "scala",
  ruby: "ruby",
  rb: "ruby",
  php: "php",
  lua: "lua",
  elixir: "elixir",
  haskell: "haskell",
  hs: "haskell",
}

// ── ast-grep JSON match schema (C3: typed, not any) ──
interface AstGrepMatch {
  file: string
  range: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
  text: string
  // ast-grep may include extra fields (nodes, metaVariables, etc.) we don't use
  [key: string]: unknown
}

// ── Locate ast-grep binary (C4: module-level cache) ──
let cachedBin: string | null | undefined

function findAstGrep(projectDir: string): string | null {
  if (cachedBin !== undefined) return cachedBin
  // Two install paths supported:
  //
  // 1. Local npm package (cwd-relative):
  //      npm install @ast-grep/cli
  //    Then the binary lives at <cwd>/node_modules/.bin/ast-grep(.cmd).
  //    Works when running opencode from a directory where the user did the
  //    install. Common pattern: install once in $HOME.
  //
  // 2. System binary on PATH:
  //    - macOS:   brew install ast-grep
  //    - Windows: winget install ast-grep   (or `cargo install ast-grep`)
  //    - Linux:   cargo install ast-grep    (or distro package manager)
  //    - manual:  https://github.com/ast-grep/ast-grep/releases
  //
  // We try the project-local path first (faster, no spawn), then fall back to
  // system PATH lookup. This matches both the "npm install in home" workflow
  // and the "system-wide install" workflow.

  // 1. Try project-local node_modules/.bin
  const localBin = path.join(
    projectDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "ast-grep.cmd" : "ast-grep",
  )
  if (fs.existsSync(localBin)) {
    cachedBin = localBin
    return localBin
  }

  // 2. Try system PATH
  const which = process.platform === "win32" ? "where" : "which"
  try {
    const result = execFileSync(which, ["ast-grep"], { stdio: "pipe" })
      .toString()
      .trim()
      .split("\n")[0]
    if (result) {
      cachedBin = result
      return result
    }
  } catch {
    // not in PATH
  }

  cachedBin = null
  return null
}

// ── Format a single ast-grep JSON match ──
function formatMatch(file: string, line: number, col: number, text: string): string {
  const lines = text.split("\n")
  const show = Math.min(lines.length, 5)
  const out: string[] = []
  out.push(`  ${file}:${line}:${col}`)
  for (let i = 0; i < show; i++) {
    const prefix = i === 0 ? "    >" : "     "
    out.push(`${prefix} ${lines[i]}`)
  }
  if (lines.length > show) out.push(`     ... (${lines.length - show} more lines)`)
  return out.join("\n")
}

// ── Tool Definition ────────────────────────────

export default tool({
  description: `AST-based structural code search using ast-grep CLI.

Unlike text grep (which matches substrings), codesearch matches code SHAPES
using a pattern language. Use it when you want to find:
  - "all classes named X"           -> pattern: "class $NAME"
  - "all async functions"           -> pattern: "async function $F($$$) { $$$ }"
  - "all calls to method X on type T"  -> pattern: "T.$METHOD($$$ARGS)"
  - "all try/catch blocks"           -> pattern: "try { $$$ } catch ($E) { $$$ }"

Use this tool INSTEAD of grep when the search is structural.
For plain text/regex search across multiple languages, fall back to grep.

Pattern syntax:
  $NAME     single AST node match (captured as variable)
  $$$       zero or more AST nodes (variadic)
  Literal text must match exactly.

Output: file:line:col per match, with the matched snippet.
Default caps at 30 results per call; raise maxResults if you need more.
Note: ast-grep run has an internal hard cap of 250 matches. If the result
count is exactly 250, the search may be incomplete — narrow the path or
pattern for full coverage.

Supported languages (20+): typescript, tsx, javascript, jsx, python, rust,
go, java, c, cpp, csharp, css, html, bash, json, yaml, toml, svelte,
swift, kotlin, scala, ruby, php, lua, elixir, haskell, ocaml.

NOTE: vue and similar single-file-component languages are NOT supported by
ast-grep. Use ripgrep (text) or the upstream explore agent for those.

Requires ast-grep binary on PATH (no npm install needed).`,

  args: {
    pattern: tool.schema
      .string()
      .describe(
        "AST pattern to search for. Examples: 'class $NAME', 'async function $F($$$) { $$$ }', 'console.log($$$)'.",
      ),
    lang: tool.schema
      .string()
      .describe(
        "Target language. Use ast-grep native name or alias (typescript|ts, tsx, js, py, rust|rs, go, etc.).",
      ),
    path: tool.schema
      .string()
      .describe("Directory to search. Defaults to current working directory.")
      .optional(),
    maxResults: tool.schema
      .number()
      .describe("Maximum number of matches to return. Defaults to 30. ast-grep run caps at 250 internally.")
      .optional(),
  },

  async execute(args, ctx) {
    // C1 fix: guard against undefined lang (was crashing with TypeError)
    const langInput = String(args.lang ?? "").toLowerCase().trim()
    if (!langInput) {
      return `Error: lang is required. Use ast-grep native name or alias (typescript|ts, tsx, js, py, rust|rs, go, etc.).`
    }
    const lang = LANG_ALIASES[langInput]
    if (!lang) {
      // Dedupe: show one name per native lang
      const seen = new Set<string>()
      const canonical = Object.entries(LANG_ALIASES)
        .filter(([, v]) => (seen.has(v) ? false : (seen.add(v), true)))
        .map(([k, v]) => (v === k ? k : `${k} (${v})`))
      return `Error: unsupported language "${args.lang}". Supported: ${canonical.join(", ")}.`
    }

    const projectDir = ctx.directory ?? ctx.worktree ?? process.cwd()
    const searchPath = path.resolve(projectDir, args.path ?? ".")
    if (!fs.existsSync(searchPath)) {
      return `Error: path not found: ${searchPath}`
    }

    const bin = findAstGrep(projectDir)
    if (!bin) {
      return `Error: ast-grep not found.

codesearch needs the ast-grep binary. Pick ONE install method:

  (A) Local npm install (most common, install in cwd or $HOME):
      cd <your-project-or-home> && npm install @ast-grep/cli

  (B) System binary (recommended for cross-project reuse):
      - macOS:   brew install ast-grep
      - Windows: winget install ast-grep   (or \`cargo install ast-grep\`)
      - Linux:   cargo install ast-grep    (or distro package manager)
      - manual:  https://github.com/ast-grep/ast-grep/releases

Search order: project-local \`node_modules/.bin/ast-grep\` first, then system PATH.`
    }

    const max = args.maxResults ?? 30

    // P1 fix: use ast-grep native directory scan instead of per-file spawn.
    // Previously we walked the tree and spawned ast-grep once per file (N spawns
    // for N files). Now we let ast-grep scan the whole directory in one process,
    // which is 10-100x faster on large codebases. mtime sorting is applied
    // AFTER matching, only on the files that actually matched.
    let raw = ""
    let spawnErr: string | null = null
    try {
      // C7: --json=compact outputs a single-line JSON array (one shot, no
      // streaming). Verified compatible with ast-grep 0.43.0. --json (pretty)
      // also works but is larger; compact is faster to transfer and parse.
      const { stdout, stderr } = await exec(
        bin,
        ["run", "--pattern", args.pattern, "--lang", lang, "--json=compact", searchPath],
        { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 },
      )
      raw = stdout
      if (stderr && stderr.trim()) spawnErr = stderr.trim().split("\n")[0]
    } catch (e: any) {
      // ast-grep exits non-zero for parse errors but may still produce
      // valid JSON on stdout. Capture whatever came out.
      raw = e?.stdout?.toString() ?? ""
      const stderr = e?.stderr?.toString() ?? e?.message ?? String(e)
      if (stderr.trim()) spawnErr = stderr.trim().split("\n")[0]
    }

    let allMatches: AstGrepMatch[] = []
    const parseErrors: string[] = []
    try {
      const parsed = JSON.parse(raw || "[]")
      if (Array.isArray(parsed)) {
        allMatches = parsed as AstGrepMatch[]
      } else {
        parseErrors.push(`ast-grep returned non-array JSON: ${typeof parsed}`)
      }
    } catch (e) {
      parseErrors.push(`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (spawnErr) parseErrors.push(`ast-grep stderr: ${spawnErr}`)

    // P1 cont: sort matches by file mtime (newest first) — what you changed
    // today is what you usually want to see. Only stat the files that matched,
    // not every candidate file in the tree.
    const withMtime = await Promise.all(
      allMatches.map(async (m) => {
        try {
          const st = await fs.promises.stat(m.file)
          return { match: m, mtime: st.mtimeMs }
        } catch {
          return { match: m, mtime: 0 }
        }
      }),
    )
    withMtime.sort((a, b) => b.mtime - a.mtime)

    const truncated = withMtime.length > max
    const shown = withMtime.slice(0, max).map((x) => x.match)

    // ── format output with adaptive degradation ──
    // When match count is small: show full detail (file:line:col + 5 lines code)
    // When growing: degrade to compact (file:line:col only, no code)
    // When large: degrade to aggregate (file: count table)
    // This prevents opencode's tool-output truncation on big result sets.
    const OUTPUT_BUDGET = 8192
    const AST_GREP_CAP = 250
    const lines: string[] = []
    lines.push(
      `codesearch: pattern="${args.pattern}" lang=${lang} path=${searchPath}`,
    )
    const hitCap = withMtime.length === AST_GREP_CAP
    lines.push(
      `  matches: ${withMtime.length}${truncated ? ` (showing first ${max}, sorted by mtime newest-first)` : " (sorted by mtime newest-first)"}${hitCap ? " — WARNING: hit ast-grep internal cap of 250, results may be incomplete" : ""}`,
    )

    if (shown.length === 0) {
      lines.push("")
      lines.push("  No matches.")
    } else {
      lines.push("")
      // Try detailed mode first, degrade if output exceeds budget
      const detailed: string[] = []
      let detailedBytes = 0
      let degradedToCompact = false
      let degradedToAggregate = false

      for (const m of shown) {
        const r = m.range?.start ?? { line: 0, column: 0 }
        const file = m.file ? path.relative(projectDir, m.file) : "?"
        let block: string
        if (!degradedToCompact) {
          block = formatMatch(file, r.line + 1, r.column + 1, m.text ?? "")
        } else {
          // Compact: one line per match, no code body
          block = `  ${file}:${r.line + 1}:${r.column + 1}`
        }
        const blockBytes = Buffer.byteLength(block, "utf-8")
        if (detailedBytes + blockBytes > OUTPUT_BUDGET && !degradedToCompact) {
          // Degrade to compact mode
          degradedToCompact = true
          detailed.push("")
          detailed.push(`  (output exceeded ${OUTPUT_BUDGET} bytes, switching to compact mode)`)
          detailed.push("")
          // Re-add this match in compact form
          block = `  ${file}:${r.line + 1}:${r.column + 1}`
        }
        if (degradedToCompact && detailedBytes + blockBytes > OUTPUT_BUDGET) {
          // Compact still too large → degrade to aggregate
          degradedToAggregate = true
          break
        }
        detailed.push(block)
        detailedBytes += blockBytes
      }

      if (degradedToAggregate) {
        // Aggregate: group by file, show count per file
        const byFile = new Map<string, number>()
        for (const x of withMtime) {
          const f = x.match.file ? path.relative(projectDir, x.match.file) : "?"
          byFile.set(f, (byFile.get(f) ?? 0) + 1)
        }
        const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1])
        lines.push(`  (too many matches, showing aggregate by file)`)
        lines.push("")
        for (const [file, count] of sorted) {
          lines.push(`  ${String(count).padStart(4)}  ${file}`)
        }
        lines.push("")
        lines.push(`  (${byFile.size} files, ${withMtime.length} matches total)`)
      } else {
        lines.push(...detailed)
        if (degradedToCompact) {
          lines.push("")
          lines.push(`  (compact mode: file:line:col only, code bodies omitted)`)
        }
      }
    }

    // Always show error log if any — completeness signal.
    if (parseErrors.length > 0) {
      lines.push("")
      lines.push(`Errors (${parseErrors.length}):`)
      for (const e of parseErrors.slice(0, 5)) lines.push(`  ${e}`)
      if (parseErrors.length > 5) lines.push(`  ... and ${parseErrors.length - 5} more`)
    }
    return lines.join("\n")
  },
})
