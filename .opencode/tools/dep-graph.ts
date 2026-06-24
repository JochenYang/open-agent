import { tool } from "@opencode-ai/plugin"
import path from "path"
import { detectLanguages } from "./parsers/detect"
import type { Parser, ImportDecl } from "./parsers/types"

/**
 * dep-graph — Module dependency graph analyzer (multi-language)
 *
 * Scans source files for import statements using language-specific parsers,
 * builds a directed graph, detects circular dependencies, identifies
 * high-coupling hotspots, and reports layer-boundary violations.
 *
 * Supported languages: TypeScript/JS, Python, Go, C#, Rust
 * Adding a new language = adding one file in parsers/, zero changes here.
 *
 * Why this is a custom tool (not just shell grep):
 * - Needs cross-file graph construction and cycle detection (topological sort)
 * - Computes in-degree metrics to find coupling hotspots
 * - Validates architectural layer rules (e.g. "ui should not import db")
 * These are graph algorithms that LLM cannot perform by grepping files one-by-one.
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

// ── Graph data structures ──

interface Graph {
  // adjacency list: module -> set of modules it imports
  edges: Map<string, Set<string>>
  // reverse adjacency: module -> set of modules that import it
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

// ── Graph construction (using pluggable parsers) ──

/**
 * Build a dependency graph by scanning all source files in the directory.
 *
 * Detects project languages, loads matching parsers, extracts imports from
 * each file, normalizes paths to canonical project-relative keys, then
 * populates adjacency + reverse-adjacency lists.
 */
async function buildGraph(srcDir: string, explicitLangs?: string[]): Promise<Graph & { parsers: Parser[] }> {
  const graph: Graph = { edges: new Map(), reverse: new Map() }

  const langInfo = await detectLanguages(srcDir, explicitLangs)
  const parsers = langInfo.parsers
  const extensions = langInfo.extensions

  if (parsers.length === 0) {
    return { ...graph, parsers: [] }
  }

  // Build extension -> parser lookup
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
    // Remove extension for canonical key (matches how imports resolve)
    const canonicalKey = relKey.replace(/\.\w+$/, "")

    const content = await Bun.file(filePath).text()

    const importDecls: ImportDecl[] = parser.extractImports(content)

    const targets = new Set<string>()
    for (const decl of importDecls) {
      // Only process local imports for dependency graph
      if (!decl.isLocal && !parser.isLocalImport(decl.rawPath)) continue

      const normalized = parser.normalizeImportPath(decl.rawPath, relKey, srcDir)
      if (normalized) {
        targets.add(normalized)
      }
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

// ── Cycle detection (DFS) ──

interface CycleResult {
  cycles: string[][]
  hasCycle: boolean
}

/** Detect all circular dependencies using DFS. */
function detectCycles(graph: Graph): CycleResult {
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const cycles: string[][] = []

  function dfs(node: string, path: string[]) {
    if (inStack.has(node)) {
      // Found a cycle — extract the cycle path
      const cycleStart = path.indexOf(node)
      if (cycleStart !== -1) {
        cycles.push(path.slice(cycleStart).concat(node))
      }
      return
    }
    if (visited.has(node)) return
    visited.add(node)
    inStack.add(node)
    path.push(node)

    const neighbors = graph.edges.get(node) || new Set()
    for (const neighbor of neighbors) {
      dfs(neighbor, [...path])
    }

    inStack.delete(node)
  }

  for (const node of graph.edges.keys()) {
    dfs(node, [])
  }

  return { cycles, hasCycle: cycles.length > 0 }
}

// ── Coupling hotspot detection ──

interface Hotspot {
  module: string
  inDegree: number
  outDegree: number
  fanIn: string[]
}

/** Find modules with high in-degree (many dependents = coupling hotspot). */
function findHotspots(graph: Graph, threshold: number): Hotspot[] {
  const hotspots: Hotspot[] = []

  for (const [module, dependents] of graph.reverse) {
    if (dependents.size >= threshold) {
      hotspots.push({
        module,
        inDegree: dependents.size,
        outDegree: graph.edges.get(module)?.size ?? 0,
        fanIn: [...dependents].slice(0, 10),
      })
    }
  }

  return hotspots.sort((a, b) => b.inDegree - a.inDegree)
}

// ── Layer boundary violation check ──

// Layer boundary rules. Forward layering is normal: ui -> service -> data.
// A violation is when a module skips over an intermediate layer (rank jump >= 2).
// Examples: ui -> data is a violation (ui should go through service first).
//           ui -> service and service -> data are normal and allowed.
const LAYER_RANK: Record<string, number> = {
  ui: 0,
  service: 1,
  data: 2,
}

const LAYER_DIR_PATTERN: Record<string, string> = {
  ui: "components|pages|views|app|ui",
  service: "services|api|controllers|handlers",
  data: "db|repository|models|store|dal",
}

function rankForModule(mod: string): number | null {
  for (const [layer, rank] of Object.entries(LAYER_RANK)) {
    const pattern = LAYER_DIR_PATTERN[layer]
    const re = new RegExp(`/(?:${pattern})/`)
    if (re.test(mod) || mod.startsWith(`${pattern}/`)) {
      return rank
    }
  }
  return null
}

function detectLayerViolations(graph: Graph): string[] {
  const violations: string[] = []

  for (const [fromMod, deps] of graph.edges) {
    const fromRank = rankForModule(fromMod)
    if (fromRank === null) continue
    for (const toMod of deps) {
      const toRank = rankForModule(toMod)
      if (toRank === null) continue
      // Flag only "ui -> data" (rank jump >= 2, skipping intermediate layers)
      // Normal layering (ui -> service, service -> data) is allowed.
      if (toRank - fromRank >= 2) {
        violations.push(`${fromMod} -> ${toMod} (rank ${fromRank} should not skip to rank ${toRank})`)
      }
    }
  }

  return violations
}

// ── Output formatting ──

function formatTree(graph: Graph, entry: string, depth: number, indent = 0, visited = new Set<string>()): string[] {
  if (visited.has(entry) || depth <= 0) {
    return [`  ${"  ".repeat(indent)}${entry}${visited.has(entry) ? " (cycle)" : ""}`]
  }
  visited.add(entry)
  const deps = graph.edges.get(entry) || new Set()
  const lines = [`  ${"  ".repeat(indent)}${entry}/`]
  for (const dep of [...deps].slice(0, 20)) {
    lines.push(...formatTree(graph, dep, depth - 1, indent + 1, new Set(visited)))
  }
  if (deps.size > 20) lines.push(`  ${"  ".repeat(indent + 1)}... and ${deps.size - 20} more`)
  return lines
}

function formatFlat(graph: Graph): string {
  const modules = [...graph.edges.keys()].sort()
  return modules.map((mod) => {
    const deps = graph.edges.get(mod) || new Set()
    return deps.size > 0 ? `  ${mod} -> [[${[...deps].join(", ")}]]` : `  ${mod} (leaf)`
  }).join("\n")
}

// ── Tool definition ──

export default tool({
  description: `Analyze module dependency graph for a codebase (multi-language).

Builds a directed graph from import statements using language-specific parsers,
then:
- Detects circular dependencies (cycles)
- Identifies coupling hotspots (modules with many dependents)
- Checks for architectural layer boundary violations (e.g. UI importing DB code)

Supports: TypeScript/JS, Python, Go, C#, Rust. Language is auto-detected from project files.
This performs cross-file graph analysis that cannot be done with simple grep or shell commands. Use when refactoring, evaluating module coupling, or enforcing architectural boundaries.`,
  args: {
    entry: tool.schema.string().describe("Entry file or directory to analyze (relative to project)").default("."),
    depth: tool.schema.number().describe("Max depth for tree output").default(3),
    format: tool.schema.enum(["tree", "flat", "summary"]).describe("Output format").default("summary"),
    hotspot_threshold: tool.schema.number().describe("Min dependents to flag as coupling hotspot").default(5),
    check_layers: tool.schema.boolean().describe("Check for architectural layer violations").default(true),
    lang: tool.schema.array(tool.schema.string()).describe("Explicit language(s) to scan (auto-detected if omitted). Options: typescript, python, go, csharp, rust").optional(),
  },
  async execute(args, ctx) {
    const srcDir = path.resolve(ctx.directory, args.entry)

    const dirError = await assertSrcDir(srcDir, args.entry)
    if (dirError) return dirError

    // Build dependency graph using pluggable parsers
    const { edges, reverse, parsers } = await buildGraph(srcDir, args.lang)
    const graph: Graph = { edges, reverse }
    const totalModules = graph.edges.size
    const totalEdges = [...graph.edges.values()].reduce((sum, deps) => sum + deps.size, 0)

    if (totalModules === 0) return `No source files found in ${args.entry}`

    // Detect cycles
    const { cycles, hasCycle } = detectCycles(graph)

    // Find hotspots
    const hotspots = findHotspots(graph, args.hotspot_threshold)

    // Check layer violations
    const violations = args.check_layers ? detectLayerViolations(graph) : []

    // Format output
    const parts: string[] = []

    parts.push(`## Dep Graph: ${args.entry}`)
    parts.push(`Languages: ${parsers.map((p) => p.name).join(", ")} | Modules: ${totalModules} | Imports: ${totalEdges} | Cycles: ${cycles.length}`)
    parts.push("")

    if (hasCycle) {
      parts.push("### Circular Dependencies")
      for (const cycle of cycles.slice(0, 10)) {
        parts.push(`  ${cycle.join(" -> ")}`)
      }
      if (cycles.length > 10) parts.push(`  ... and ${cycles.length - 10} more cycles`)
      parts.push("")
    } else {
      parts.push("### Circular Dependencies: None")
      parts.push("")
    }

    if (hotspots.length > 0) {
      parts.push("### Coupling Hotspots")
      for (const h of hotspots.slice(0, 15)) {
        parts.push(`  ${h.module}: ${h.inDegree} dependents, ${h.outDegree} deps`)
      }
      parts.push("")
    }

    if (violations.length > 0) {
      parts.push("### Layer Violations")
      for (const v of violations.slice(0, 20)) {
        parts.push(`  ${v}`)
      }
      parts.push("")
    }

    // Always show a top-level tree in summary mode (or when format=tree)
    if (args.format === "summary" || args.format === "tree") {
      parts.push("### Top-level Tree (depth 2)")
      const roots = [...graph.edges.keys()].filter(
        (m) => (graph.reverse.get(m)?.size ?? 0) === 0,
      ).slice(0, 3)
      for (const root of roots) {
        parts.push(...formatTree(graph, root, 2))
      }
      parts.push("")
    }

    if (args.format === "tree" || args.format === "flat") {
      parts.push(`### ${args.format === "tree" ? "Tree" : "Flat"} View`)
      if (args.format === "tree") {
        const roots = [...graph.edges.keys()].filter(
          (m) => (graph.reverse.get(m)?.size ?? 0) === 0,
        ).slice(0, 5)
        for (const root of roots) {
          parts.push(...formatTree(graph, root, args.depth))
        }
      } else {
        parts.push(formatFlat(graph))
      }
    }

    return parts.join("\n")
  },
})
