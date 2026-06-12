/**
 * typescript.ts — Parser plugin for TypeScript / JavaScript
 *
 * Handles: .ts, .tsx, .js, .jsx, .mjs
 * Capabilities:
 *   - extractImports: ESM import + CommonJS require
 *   - parseTypeDefs:  interface, type alias, enum
 *
 * Extracted from the original dep-graph.ts and schema-diff.ts single-language
 * implementations. This file is the reference parser — all others follow its shape.
 */

import path from "path"
import type { Parser, ImportDecl, TypeDef, TypeField } from "./types"

// ── Import extraction ──

/** ESM: import ... from 'path' / import 'path' */
const ESM_IMPORT_RE = /import\s+(?:(?:\w+|\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+)?['"]([^'"]+)['"]/g
/** CommonJS: require('path') */
const CJS_REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
/** Re-export: export ... from 'path' */
const RE_EXPORT_RE = /export\s+(?:\w+\s+)?(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/g
/** Named imports: { foo, bar as baz } */
const NAMED_IMPORT_RE = /\{([^}]+)\}/
/** Relative import indicator */
const RELATIVE_RE = /^[./]/

/** Extract import declarations from TS/JS source content. */
function extractImports(content: string): ImportDecl[] {
  const imports: ImportDecl[] = []
  const seen = new Set<string>()
  const lines = content.split("\n")

  // Step 1: scan ESM imports
  let match: RegExpExecArray | null
  const esmRe = new RegExp(ESM_IMPORT_RE.source, ESM_IMPORT_RE.flags)
  while ((match = esmRe.exec(content)) !== null) {
    const rawPath = match[1]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = `${rawPath}:${lineNum}`
    if (seen.has(key)) continue
    seen.add(key)

    // Step 2: extract named symbols if present
    const namedMatch = match[0].match(NAMED_IMPORT_RE)
    const symbols = namedMatch
      ? namedMatch[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean)
      : undefined

    imports.push({
      rawPath,
      isLocal: RELATIVE_RE.test(rawPath),
      symbols,
      line: lineNum,
    })
  }

  // Step 3: scan CommonJS require (only if no ESM imports found — avoids duplicates)
  if (imports.length === 0) {
    const cjsRe = new RegExp(CJS_REQUIRE_RE.source, CJS_REQUIRE_RE.flags)
    while ((match = cjsRe.exec(content)) !== null) {
      const rawPath = match[1]
      const lineNum = content.slice(0, match.index).split("\n").length
      const key = `${rawPath}:${lineNum}`
      if (seen.has(key)) continue
      seen.add(key)
      imports.push({ rawPath, isLocal: RELATIVE_RE.test(rawPath), line: lineNum })
    }
  }

  // Step 4: scan re-exports (these also create dependencies)
  const reExportRe = new RegExp(RE_EXPORT_RE.source, RE_EXPORT_RE.flags)
  while ((match = reExportRe.exec(content)) !== null) {
    const rawPath = match[1]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = `re:${rawPath}:${lineNum}`
    if (seen.has(key)) continue
    seen.add(key)
    imports.push({ rawPath, isLocal: RELATIVE_RE.test(rawPath), line: lineNum })
  }

  return imports
}

// ── Type definition parsing ──

const INTERFACE_RE = /(?:export\s+)?interface\s+(\w+)\s*(?:extends\s+[\w,\s]+\s*)?\{/g
const TYPE_ALIAS_RE = /(?:export\s+)?type\s+(\w+)\s*=\s*/g
const ENUM_RE = /(?:export\s+)?enum\s+(\w+)\s*\{/g
const FIELD_RE = /(\w+)(\??):\s*([^;]+)/g
const ENUM_MEMBER_RE = /(\w+)\s*[=,]/g

/** Parse type definitions from a TypeScript file. */
function parseTypeDefs(content: string, filePath: string): TypeDef[] {
  const defs: TypeDef[] = []
  let match: RegExpExecArray | null

  // Step 5: extract interfaces
  const ifaceRe = new RegExp(INTERFACE_RE.source, INTERFACE_RE.flags)
  while ((match = ifaceRe.exec(content)) !== null) {
    const name = match[1]
    const startLine = content.slice(0, match.index).split("\n").length
    const isExported = match[0].startsWith("export")
    const fields = extractFields(content, match.index + match[0].length, startLine)
    defs.push({ name, kind: "interface", fields, line: startLine, exported: isExported })
  }

  // Step 6: extract type aliases (object types only)
  const typeRe = new RegExp(TYPE_ALIAS_RE.source, TYPE_ALIAS_RE.flags)
  while ((match = typeRe.exec(content)) !== null) {
    const name = match[1]
    const startLine = content.slice(0, match.index).split("\n").length
    const isExported = match[0].startsWith("export")
    const rest = content.slice(match.index + match[0].length)
    if (rest.trimStart().startsWith("{")) {
      const fields = extractFields(content, match.index + match[0].length, startLine)
      defs.push({ name, kind: "type", fields, line: startLine, exported: isExported })
    }
  }

  // Step 7: extract enums
  const enumRe = new RegExp(ENUM_RE.source, ENUM_RE.flags)
  while ((match = enumRe.exec(content)) !== null) {
    const name = match[1]
    const startLine = content.slice(0, match.index).split("\n").length
    const isExported = match[0].startsWith("export")
    const bodyStart = match.index + match[0].length
    const bodyEnd = content.indexOf("}", bodyStart)
    const body = content.slice(bodyStart, bodyEnd)
    const fields: TypeField[] = []
    const memberRe = new RegExp(ENUM_MEMBER_RE.source, ENUM_MEMBER_RE.flags)
    let m: RegExpExecArray | null
    while ((m = memberRe.exec(body)) !== null) {
      fields.push({ name: m[1], optional: false, type: "enum-member", line: startLine })
    }
    defs.push({ name, kind: "enum", fields, line: startLine, exported: isExported })
  }

  return defs
}

/** Extract fields from an interface/type body starting at offset. */
function extractFields(content: string, startOffset: number, baseLine: number): TypeField[] {
  const fields: TypeField[] = []
  let depth = 1
  let pos = startOffset
  const len = content.length

  while (pos < len && depth > 0) {
    if (content[pos] === "{") depth++
    else if (content[pos] === "}") depth--
    pos++
  }

  const body = content.slice(startOffset, pos - 1)
  const fieldRe = new RegExp(FIELD_RE.source, FIELD_RE.flags)
  let m: RegExpExecArray | null
  while ((m = fieldRe.exec(body)) !== null) {
    const lineOffset = body.slice(0, m.index).split("\n").length - 1
    fields.push({
      name: m[1],
      optional: m[2] === "?",
      type: m[3].trim().replace(/[;,]\s*$/, ""),
      line: baseLine + lineOffset,
    })
  }

  return fields
}

// ── Path normalization ──

function isLocalImport(rawPath: string): boolean {
  return RELATIVE_RE.test(rawPath)
}

function normalizeImportPath(rawPath: string, fromFile: string, srcDir: string): string | null {
  // fromFile is relative to srcDir (e.g. "index.ts" or "lib/config.ts").
  // Resolve against srcDir first to get an absolute path, then compute
  // the import target relative to srcDir.
  const absFromFile = path.resolve(srcDir, fromFile)
  const dir = path.dirname(absFromFile)
  const resolved = path.resolve(dir, rawPath)
  const relative = path.relative(srcDir, resolved)
  if (relative.startsWith("..")) return null
  // Strip TS/JS extensions for canonical key
  return relative.replace(/\\/g, "/").replace(/\.(ts|tsx|js|jsx|mjs)$/, "")
}

// ── Export parser instance ──

export const typescriptParser: Parser = {
  name: "TypeScript",
  extensions: ["ts", "tsx", "js", "jsx", "mjs"],
  extractImports,
  parseTypeDefs,
  isLocalImport,
  normalizeImportPath,
}