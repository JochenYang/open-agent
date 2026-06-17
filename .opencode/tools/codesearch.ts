/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { execFile } from "child_process"
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

// ── Locate ast-grep binary ──
function findAstGrep(): string | null {
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
  // We try the cwd-local path first (faster, no spawn), then fall back to
  // system PATH lookup. This matches both the "npm install in home" workflow
  // and the "system-wide install" workflow.

  // 1. Try cwd-local node_modules/.bin
  const localBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "ast-grep.cmd" : "ast-grep",
  )
  if (fs.existsSync(localBin)) return localBin

  // 2. Try system PATH
  const which = process.platform === "win32" ? "where" : "which"
  try {
    const result = require("child_process")
      .execSync(`${which} ast-grep`, { stdio: "pipe" })
      .toString()
      .trim()
      .split("\n")[0]
    if (result) return result
  } catch {
    // not in PATH
  }

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
Default caps at 50 results per call; raise maxResults if you need more.

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
      .describe("Maximum number of matches to return. Defaults to 50.")
      .optional(),
  },

  async execute(args) {
    const lang = LANG_ALIASES[args.lang.toLowerCase()]
    if (!lang) {
      // Dedupe: show one name per native lang
      const seen = new Set<string>()
      const canonical = Object.entries(LANG_ALIASES)
        .filter(([_, v]) => (seen.has(v) ? false : (seen.add(v), true)))
        .map(([k, v]) => v === k ? k : `${k} (${v})`)
      return `Error: unsupported language "${args.lang}". Supported: ${canonical.join(", ")}.`
    }

    const searchPath = path.resolve(args.path ?? process.cwd())
    if (!fs.existsSync(searchPath)) {
      return `Error: path not found: ${searchPath}`
    }

    const bin = findAstGrep()
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

Search order: cwd-local \`node_modules/.bin/ast-grep\` first, then system PATH.`
    }

    const max = args.maxResults ?? 50

    // ── Run ast-grep with JSON output ──
    let stdout: string
    try {
      const result = await exec(
        bin,
        ["run", "--pattern", args.pattern, "--lang", lang, "--json=compact", searchPath],
        { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 },
      )
      stdout = result.stdout
    } catch (e: any) {
      // ast-grep exits with non-zero when no matches found; check stdout
      if (e.stdout) {
        stdout = e.stdout
      } else {
        return `Error: ast-grep failed: ${e.stderr?.toString() ?? e.message}`
      }
    }

    let matches: any[]
    try {
      matches = JSON.parse(stdout || "[]")
    } catch (e) {
      return `Error: failed to parse ast-grep output: ${e instanceof Error ? e.message : String(e)}\nOutput: ${stdout.slice(0, 200)}`
    }

    if (matches.length === 0) {
      return `codesearch: pattern="${args.pattern}" lang=${lang} path=${searchPath}\n  No matches.`
    }

    const truncated = matches.length > max
    const shown = truncated ? matches.slice(0, max) : matches

    const lines: string[] = []
    lines.push(`codesearch: pattern="${args.pattern}" lang=${lang} path=${searchPath}`)
    lines.push(`  matches: ${matches.length}${truncated ? ` (showing first ${max})` : ""}`)
    lines.push("")

    for (const m of shown) {
      const r = m.range?.start ?? { line: 0, column: 0 }
      const file = m.file ? path.relative(searchPath, m.file) : "?"
      lines.push(formatMatch(file, r.line + 1, r.column + 1, m.text ?? ""))
    }
    return lines.join("\n")
  },
})
