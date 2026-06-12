/**
 * types.ts — Unified type definitions for multi-language parser plugins
 *
 * All parsers must conform to the Parser interface below.
 * The main tools (dep-graph, schema-diff) consume these types only —
 * they never parse language-specific syntax directly.
 *
 * Architecture:
 *   tools/dep-graph.ts ──┐
 *                        ├──> parsers/types.ts (Parser interface)
 *   tools/schema-diff.ts ┘         │
 *                    ┌─────────────┼─────────────┐
 *                    ↓             ↓             ↓
 *            parsers/typescript  parsers/python  parsers/go ...
 *
 * Adding a new language = adding one file in parsers/, zero changes to main tools.
 */

// ── Import declaration (used by dep-graph) ──

/** A single import/require statement extracted from a source file. */
export interface ImportDecl {
  /** The raw import path as written in source (e.g. "./utils", "os", "django.http") */
  rawPath: string
  /** Whether this is a relative/local import (vs. stdlib or third-party) */
  isLocal: boolean
  /** Imported symbols, if explicitly named (e.g. ["useState", "useEffect"]) */
  symbols?: string[]
  /** Line number in the source file (1-based) */
  line: number
}

// ── Type definition (used by schema-diff) ──

/** A field/property/member within a type definition. */
export interface TypeField {
  name: string
  optional: boolean
  type: string
  line: number
}

/** A top-level type definition (class, interface, struct, etc.). */
export interface TypeDef {
  name: string
  /** Language-agnostic kind category */
  kind: "interface" | "type" | "enum" | "class" | "struct"
  fields: TypeField[]
  line: number
  /** Whether this type is publicly exported/visible */
  exported: boolean
}

// ── Parser interface (contract for all language parsers) ──

/**
 * Parser — the contract every language parser must implement.
 *
 * Two capabilities:
 * 1. extractImports — for dep-graph (builds module dependency graph)
 * 2. parseTypeDefs  — for schema-diff (detects API contract changes)
 *
 * A parser may implement one or both; return empty array for unsupported capability.
 */
export interface Parser {
  /** Human-readable language name (e.g. "TypeScript", "Go") */
  name: string

  /** File extensions this parser handles (without dot, e.g. ["ts", "tsx"]) */
  extensions: string[]

  /**
   * Extract import declarations from source file content.
   * Returns only import statements — no side-effect imports or re-exports.
   */
  extractImports(content: string): ImportDecl[]

  /**
   * Parse type definitions from source file content.
   * Extracts public API surface: classes, interfaces, structs, enums, type aliases.
   */
  parseTypeDefs(content: string, filePath: string): TypeDef[]

  /**
   * Determine if an import path refers to a local module (within the project).
   * Language-specific: TS uses "./" prefix, Go uses relative package paths,
   * Python uses relative dots, Rust uses "crate::" / "super::", etc.
   */
  isLocalImport(rawPath: string): boolean

  /**
   * Normalize an import path to a project-relative canonical key.
   * Returns null if the path cannot be resolved or is outside the project.
   */
  normalizeImportPath(rawPath: string, fromFile: string, srcDir: string): string | null
}

// ── Language detection result ──

/** Result of auto-detecting the project's primary language(s). */
export interface LanguageInfo {
  /** Detected language(s) sorted by file count (most files first) */
  languages: string[]
  /** File extensions to scan, grouped by detected languages */
  extensions: string[]
  /** The parser instances for detected languages */
  parsers: Parser[]
}