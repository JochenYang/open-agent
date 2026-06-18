/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import path from "path"
import { detectLanguages } from "./parsers/detect"
import type { Parser, ImportDecl, TypeDef } from "./parsers/types"

/**
 * dead-code — Dead code detector (multi-language)
 *
 * Finds exported symbols (types, classes, functions) that are never imported
 * by any other module in the project. These are candidates for removal.
 *
 * Why this is a custom tool (not just IDE/linter):
 * - ESLint/Pylint/clang-tidy only work per-language, can't detect cross-language dead code
 * - IDE "Find References" is interactive and manual — cannot audit an entire project
 * - Needs full project graph construction, which LLM cannot do by grepping one-by-one
 *
 * Supported languages: TypeScript/JS, Python, Go, C#, Rust, C++
 */

// ── Helpers ──

/**
 * Verify that a source directory exists.
 * Returns an error message string if missing, or null if OK.
 */
async function assertSrcDir(srcDir: string, entry: string): Promise<string | null> {
  try {
    const stat = await Bun.file(srcDir).stat()
    if (!stat) return `Error: ${entry} not found`
    return null
  } catch {
    return `Error: ${entry} not found`
  }
}

// ── Graph construction (shared with dep-graph) ──

interface Graph {
  edges: Map<string, Set<string>>
  reverse: Map<string, Set<string>>
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  "out",
  "target",
  "vendor",
])

function isSkippedSourceFile(srcDir: string, filePath: string): boolean {
  const parts = path.relative(srcDir, filePath).split(/[\\/]+/)
  return parts.some((part) => SKIP_DIRS.has(part))
}

async function buildGraph(srcDir: string, explicitLangs?: string[]): Promise<Graph & { parsers: Parser[] }> {
  const graph: Graph = { edges: new Map(), reverse: new Map() }

  const langInfo = await detectLanguages(srcDir, explicitLangs)
  const parsers = langInfo.parsers
  const extensions = langInfo.extensions

  if (parsers.length === 0) return { ...graph, parsers: [] }

  const extToParser = new Map<string, Parser>()
  for (const parser of parsers) {
    for (const ext of parser.extensions) {
      extToParser.set(ext, parser)
    }
  }

  const extPattern = extensions.join(",")
  const glob = new Bun.Glob(`**/*.{${extPattern}}`)
  const files = Array.from(glob.scanSync({ cwd: srcDir, absolute: true }))
    .filter((filePath) => !isSkippedSourceFile(srcDir, filePath))

  for (const filePath of files) {
    const ext = filePath.split(".").pop()!.toLowerCase()
    const parser = extToParser.get(ext)
    if (!parser) continue

    const relKey = path.relative(srcDir, filePath).replace(/\\/g, "/")
    const canonicalKey = relKey.replace(/\.\w+$/, "")

    const content = await Bun.file(filePath).text()
    const importDecls: ImportDecl[] = parser.extractImports(content)

    const targets = new Set<string>()
    for (const decl of importDecls) {
      if (!decl.isLocal && !parser.isLocalImport(decl.rawPath)) continue
      const normalized = parser.normalizeImportPath(decl.rawPath, relKey, srcDir)
      if (normalized) targets.add(normalized)
    }

    graph.edges.set(canonicalKey, targets)
    if (!graph.reverse.has(canonicalKey)) graph.reverse.set(canonicalKey, new Set())
    for (const target of targets) {
      if (!graph.reverse.has(target)) graph.reverse.set(target, new Set())
      graph.reverse.get(target)!.add(canonicalKey)
    }
  }

  return { ...graph, parsers }
}

// ── Exported symbol extraction ──

interface ExportedSymbol {
  /** Symbol name (e.g. "UserService", "Config") */
  name: string
  /** Symbol kind (class, interface, enum, etc.) */
  kind: TypeDef["kind"]
  /** Module path (project-relative, without extension) */
  module: string
  /** Source file path (project-relative, with extension) */
  file: string
  /** Line number in the source file */
  line: number
}

/**
 * Extract all exported symbols from source files.
 */
async function extractExportedSymbols(srcDir: string, explicitLangs?: string[]): Promise<ExportedSymbol[]> {
  const symbols: ExportedSymbol[] = []

  const langInfo = await detectLanguages(srcDir, explicitLangs)
  const parsers = langInfo.parsers
  const extensions = langInfo.extensions

  if (parsers.length === 0) return []

  const extToParser = new Map<string, Parser>()
  for (const parser of parsers) {
    for (const ext of parser.extensions) {
      extToParser.set(ext, parser)
    }
  }

  const extPattern = extensions.join(",")
  const glob = new Bun.Glob(`**/*.{${extPattern}}`)
  const files = Array.from(glob.scanSync({ cwd: srcDir, absolute: true }))
    .filter((filePath) => !isSkippedSourceFile(srcDir, filePath))

  for (const filePath of files) {
    const ext = filePath.split(".").pop()!.toLowerCase()
    const parser = extToParser.get(ext)
    if (!parser) continue

    const relKey = path.relative(srcDir, filePath).replace(/\\/g, "/")
    const canonicalKey = relKey.replace(/\.\w+$/, "")

    const content = await Bun.file(filePath).text()
    const typeDefs = parser.parseTypeDefs(content, relKey)

    for (const def of typeDefs) {
      if (def.exported) {
        symbols.push({
          name: def.name,
          kind: def.kind,
          module: canonicalKey,
          file: relKey,
          line: def.line,
        })
      }
    }
  }

  return symbols
}

// ── Dead code analysis ──

interface DeadModule {
  module: string
  exportedSymbols: ExportedSymbol[]
}

/**
 * Analyze the project for dead code.
 */
function findDeadCode(
  graph: Graph,
  symbols: ExportedSymbol[],
  entryPoints: string[],
): { deadModules: DeadModule[]; totalExported: number; totalModules: number } {
  const entrySet = new Set(entryPoints)

  const deadModules: DeadModule[] = []

  for (const [module, dependents] of graph.reverse) {
    // Entry points are never dead (main, index, app, etc.)
    if (entrySet.has(module)) continue
    // Modules with dependents are not dead
    if (dependents.size > 0) continue
    // Module exists only as an import target — it was never scanned, so we
    // have no exported-symbol data for it and cannot classify it.
    if (!graph.edges.has(module)) continue

    // Collect exported symbols for this dead module
    const moduleSymbols = symbols.filter((s) => s.module === module)

    deadModules.push({
      module,
      exportedSymbols: moduleSymbols,
    })
  }

  // Sort by number of dead exports (most wasted code first)
  deadModules.sort((a, b) => b.exportedSymbols.length - a.exportedSymbols.length)

  return {
    deadModules,
    totalExported: symbols.length,
    totalModules: graph.edges.size,
  }
}

// ── Tool definition ──

const DEFAULT_ENTRIES = [
  "index", "main", "app", "server", "cli",
  "mod", "lib", "src/index", "src/main", "src/app",
]

export default tool({
  description: `Detect dead code (unused exports) across a multi-language project.

Finds exported symbols (types, classes, functions) that are never imported by any
other module. These are safe candidates for removal.

Algorithm:
1. Build module dependency graph (same engine as dep-graph)
2. Extract all exported/public type definitions using language-specific parsers
3. Find modules with 0 dependents (dead modules)
4. Report dead exports grouped by module

Supports: TypeScript/JS, Python, Go, C#, Rust, C++.
Use when cleaning up technical debt, before refactoring, or during code review.`,
  args: {
    entry: tool.schema.string().describe("Source directory to analyze (relative to project)").default("."),
    entry_points: tool.schema.array(tool.schema.string()).describe("Entry point modules that should never be flagged as dead (e.g. ['index', 'main'])").default(DEFAULT_ENTRIES),
    min_exports: tool.schema.number().describe("Minimum exported symbols in a dead module to report").default(1),
    lang: tool.schema.array(tool.schema.string()).describe("Explicit language(s) to scan (auto-detected if omitted). Options: typescript, python, go, csharp, rust, cpp").optional(),
  },
  async execute(args, ctx) {
    const srcDir = path.resolve(ctx.directory, args.entry)

    const dirError = await assertSrcDir(srcDir, args.entry)
    if (dirError) return dirError

    const { edges, reverse, parsers } = await buildGraph(srcDir, args.lang)
    const graph: Graph = { edges, reverse }

    if (graph.edges.size === 0) return `No source files found in ${args.entry}`

    const symbols = await extractExportedSymbols(srcDir, args.lang)

    const { deadModules, totalExported, totalModules } = findDeadCode(
      graph, symbols, args.entry_points,
    )

    const parts: string[] = []

    parts.push(`## Dead Code: ${args.entry}`)
    parts.push(`Languages: ${parsers.map((p) => p.name).join(", ")} | Modules: ${totalModules} | Exported symbols: ${totalExported} | Dead modules: ${deadModules.length}`)
    parts.push("")

    if (deadModules.length === 0) {
      parts.push("No dead modules detected. All exported modules have at least one dependent.")
      return parts.join("\n")
    }

    // Summary
    const totalDeadExports = deadModules.reduce((sum, m) => sum + m.exportedSymbols.length, 0)
    parts.push(`### Summary`)
    parts.push(`  Dead modules: ${deadModules.length} | Dead exports: ${totalDeadExports} / ${totalExported} (${Math.round(totalDeadExports / totalExported * 100)}% of all exports)`)
    parts.push("")

    // Dead modules detail
    parts.push("### Dead Modules (0 dependents)")
    for (const dm of deadModules) {
      if (dm.exportedSymbols.length < args.min_exports) continue

      parts.push(`  ${dm.module}/ (${dm.exportedSymbols.length} dead exports)`)

      for (const sym of dm.exportedSymbols.slice(0, 10)) {
        parts.push(`    - ${sym.kind} ${sym.name} (${sym.file}:${sym.line})`)
      }
      if (dm.exportedSymbols.length > 10) {
        parts.push(`    ... and ${dm.exportedSymbols.length - 10} more`)
      }
    }
    parts.push("")

    // Top dead modules by waste
    const topDead = deadModules
      .filter((m) => m.exportedSymbols.length >= args.min_exports)
      .slice(0, 10)

    if (topDead.length > 0) {
      parts.push("### Top Dead Modules by Waste")
      for (const dm of topDead) {
        parts.push(`  ${dm.module}: ${dm.exportedSymbols.length} unused exports`)
      }
    }

    return parts.join("\n")
  },
})
