/**
 * detect.ts — Language auto-detection from project file structure
 *
 * Scans the project directory for source files, counts them by extension,
 * and returns the appropriate Parser instances for detected languages.
 *
 * Used by dep-graph and schema-diff to automatically determine which
 * parsers to load — no manual --lang flag needed in most cases.
 *
 * Detection strategy:
 *   1. Count source files by extension
 *   2. Map extensions to language parsers
 *   3. Sort by file count (most files = primary language)
 *   4. Load only the relevant parsers (lazy import)
 */

import type { Parser, LanguageInfo } from "./types"

// ── Parser registry (lazy-loaded) ──

/** Map of extension -> parser module path for lazy loading */
const PARSER_MODULES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "typescript",
  jsx: "typescript",
  mjs: "typescript",
  py: "python",
  go: "go",
  cs: "csharp",
  rs: "rust",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  c: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  h: "cpp",
  hh: "cpp",
}

/** Cache for loaded parser instances */
const parserCache = new Map<string, Parser>()

/** Dynamically load a parser by language key. */
async function loadParser(langKey: string): Promise<Parser | null> {
  if (parserCache.has(langKey)) return parserCache.get(langKey)!

  try {
    const mod = await import(`./${langKey}.ts`)
    // Each parser module exports a named export like "typescriptParser"
    const parserKey = `${langKey}Parser`
    const parser = mod[parserKey] as Parser | undefined
    if (parser && parser.name && parser.extensions) {
      parserCache.set(langKey, parser)
      return parser
    }
    return null
  } catch {
    // Parser module not found — graceful degradation
    return null
  }
}

// ── Language detection ──

/** Minimum file count to consider a language "present" in the project */
const MIN_FILE_THRESHOLD = 1

/** Known project config files that indicate a language's presence */
const LANGUAGE_MARKERS: Record<string, string[]> = {
  TypeScript: ["tsconfig.json"],
  Python: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"],
  Go: ["go.mod", "go.sum"],
  "C#": ["*.csproj", "*.sln", "global.json", "nuget.config"],
  Rust: ["Cargo.toml", "Cargo.lock"],
  "C++": ["CMakeLists.txt", "Makefile", "meson.build", "BUILD", "WORKSPACE"],
}

/** File extensions to scan (all supported languages combined) */
const ALL_EXTENSIONS = Object.keys(PARSER_MODULES)

/**
 * Auto-detect project languages by scanning file structure.
 *
 * Step 1: Check for language marker files (tsconfig.json, go.mod, etc.)
 * Step 2: Count source files by extension
 * Step 3: Sort languages by prevalence
 * Step 4: Load parser instances for detected languages
 */
export async function detectLanguages(srcDir: string, explicitLangs?: string[]): Promise<LanguageInfo> {
  const extensionCounts = new Map<string, number>()

  // Step 1: if explicit languages specified, use them directly
  if (explicitLangs && explicitLangs.length > 0) {
    const extensions: string[] = []
    const parsers: Parser[] = []

    for (const lang of explicitLangs) {
      const parser = await loadParser(lang.toLowerCase().replace("#", "sharp").replace("csharp", "csharp"))
      if (parser) {
        parsers.push(parser)
        extensions.push(...parser.extensions)
      }
    }

    return { languages: explicitLangs, extensions, parsers }
  }

  // Step 2: scan source files by extension
  const extPattern = ALL_EXTENSIONS.join(",")
  const glob = new Bun.Glob(`**/*.{${extPattern}}`)

  try {
    for (const filePath of glob.scanSync({ cwd: srcDir, absolute: false })) {
      const ext = filePath.split(".").pop()!.toLowerCase()
      extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1)
    }
  } catch {
    // Directory may not exist or be unreadable
  }

  // Step 3: group extensions by language and count total files
  const languageFileCounts = new Map<string, { count: number; extensions: string[] }>()

  for (const [ext, count] of extensionCounts) {
    const langKey = PARSER_MODULES[ext]
    if (!langKey) continue

    const existing = languageFileCounts.get(langKey)
    if (existing) {
      existing.count += count
      if (!existing.extensions.includes(ext)) existing.extensions.push(ext)
    } else {
      languageFileCounts.set(langKey, { count, extensions: [ext] })
    }
  }

  // Also check for marker files (adds languages with 0 source files but present config)
  for (const [langName, markers] of Object.entries(LANGUAGE_MARKERS)) {
    const langKey = langName.toLowerCase().replace("#", "sharp").replace(" ", "")
    if (languageFileCounts.has(langKey)) continue

    for (const marker of markers) {
      const markerGlob = new Bun.Glob(marker)
      if (markerGlob.scanSync({ cwd: srcDir }).length > 0) {
        languageFileCounts.set(langKey, { count: 0, extensions: [] })
        break
      }
    }
  }

  // Step 4: sort by file count, load parsers
  const sorted = [...languageFileCounts.entries()]
    .filter(([, data]) => data.count >= MIN_FILE_THRESHOLD || data.extensions.length === 0)
    .sort((a, b) => b[1].count - a[1].count)

  const languages: string[] = []
  const extensions: string[] = []
  const parsers: Parser[] = []

  for (const [langKey, data] of sorted) {
    const parser = await loadParser(langKey)
    if (!parser) continue

    languages.push(parser.name)
    parsers.push(parser)
    extensions.push(...data.extensions.length > 0 ? data.extensions : parser.extensions)
  }

  // Fallback: if no language detected, default to TypeScript
  if (parsers.length === 0) {
    const tsParser = await loadParser("typescript")
    if (tsParser) {
      languages.push(tsParser.name)
      parsers.push(tsParser)
      extensions.push(...tsParser.extensions)
    }
  }

  return { languages, extensions, parsers }
}

/** Get all registered parser instances (for explicit --lang usage). */
export function getRegisteredExtensions(): string[] {
  return Object.keys(PARSER_MODULES)
}