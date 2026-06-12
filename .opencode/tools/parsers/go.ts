/**
 * go.ts — Parser plugin for Go
 *
 * Handles: .go
 * Capabilities:
 *   - extractImports: import blocks (single and multi-line)
 *   - parseTypeDefs:  struct, interface, type alias
 *
 * Go import resolution note:
 *   Go uses module paths from go.mod (e.g. "github.com/myorg/myapp").
 *   Local imports are identified by matching the module prefix.
 *   The normalizeImportPath method strips the module prefix to get a project-relative path.
 */

import path from "path"
import type { Parser, ImportDecl, TypeDef, TypeField } from "./types"

// ── Import extraction ──

/** Single import: import "path" */
const SINGLE_IMPORT_RE = /import\s+(?:(\w+)\s+)?"([^"]+)"/g
/** Multi-line import block: import ( ... ) */
const IMPORT_BLOCK_RE = /import\s*\(\s*([\s\S]*?)\s*\)/g
/** Individual import lines within a block */
const BLOCK_IMPORT_RE = /(?:(\w+)\s+)?"([^"]+)"/g

/** Extract import declarations from Go source content. */
function extractImports(content: string): ImportDecl[] {
  const imports: ImportDecl[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  // Step 1: scan multi-line import blocks
  const blockRe = new RegExp(IMPORT_BLOCK_RE.source, IMPORT_BLOCK_RE.flags)
  while ((match = blockRe.exec(content)) !== null) {
    const blockBody = match[1]
    const blockStartLine = content.slice(0, match.index).split("\n").length
    const blockStartOffset = match.index

    const lineRe = new RegExp(BLOCK_IMPORT_RE.source, BLOCK_IMPORT_RE.flags)
    let innerMatch: RegExpExecArray | null
    while ((innerMatch = lineRe.exec(blockBody)) !== null) {
      const alias = innerMatch[1]
      const rawPath = innerMatch[2]
      const lineInBlock = blockBody.slice(0, innerMatch.index).split("\n").length - 1
      const lineNum = blockStartLine + lineInBlock
      const key = `${rawPath}:${lineNum}`
      if (seen.has(key)) continue
      seen.add(key)

      imports.push({
        rawPath,
        isLocal: false, // Go local detection needs module prefix — set by isLocalImport
        symbols: alias ? [alias] : undefined,
        line: lineNum,
      })
    }
  }

  // Step 2: scan single imports (outside blocks)
  const singleRe = new RegExp(SINGLE_IMPORT_RE.source, SINGLE_IMPORT_RE.flags)
  while ((match = singleRe.exec(content)) !== null) {
    // Skip if this import is inside a block (already parsed above)
    if (isInsideImportBlock(content, match.index)) continue
    const alias = match[1]
    const rawPath = match[2]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = `${rawPath}:${lineNum}`
    if (seen.has(key)) continue
    seen.add(key)

    imports.push({
      rawPath,
      isLocal: false,
      symbols: alias ? [alias] : undefined,
      line: lineNum,
    })
  }

  return imports
}

/** Check if a position in content is inside an import (...) block. */
function isInsideImportBlock(content: string, pos: number): boolean {
  // Step 3: look backwards for "import (" that isn't closed yet
  const before = content.slice(0, pos)
  const lastBlockOpen = before.lastIndexOf("import (")
  if (lastBlockOpen === -1) return false
  const afterBlockOpen = content.slice(lastBlockOpen)
  const blockClose = afterBlockOpen.indexOf("\n)")
  return blockClose !== -1 && lastBlockOpen + blockClose > pos
}

// ── Type definition parsing ──

const STRUCT_RE = /type\s+(\w+)\s+struct\s*\{/g
const INTERFACE_RE = /type\s+(\w+)\s+interface\s*\{/g
const TYPE_ALIAS_RE = /type\s+(\w+)\s+(?!struct|interface)(\w+(?:\.\w+)?)\s*(?:=|$)/gm

/** Go struct field: Name Type or Name Type `tag` */
const STRUCT_FIELD_RE = /^(\w+)\s+([\w.*\[\]]+)(?:\s+`[^`]*`)?/gm
/** Go interface method: MethodName(args) returns */
const INTERFACE_METHOD_RE = /^(\w+)\s*\(/gm

/** Parse type definitions from a Go source file. */
function parseTypeDefs(content: string, filePath: string): TypeDef[] {
  const defs: TypeDef[] = []
  let match: RegExpExecArray | null

  // Step 4: extract structs
  const structRe = new RegExp(STRUCT_RE.source, STRUCT_RE.flags)
  while ((match = structRe.exec(content)) !== null) {
    const name = match[1]
    const startLine = content.slice(0, match.index).split("\n").length
    const isExported = name[0] === name[0].toUpperCase() && name[0] !== "_"
    const fields = extractStructFields(content, match.index + match[0].length, startLine)
    defs.push({ name, kind: "struct", fields, line: startLine, exported: isExported })
  }

  // Step 5: extract interfaces
  const ifaceRe = new RegExp(INTERFACE_RE.source, INTERFACE_RE.flags)
  while ((match = ifaceRe.exec(content)) !== null) {
    const name = match[1]
    const startLine = content.slice(0, match.index).split("\n").length
    const isExported = name[0] === name[0].toUpperCase() && name[0] !== "_"
    const fields = extractInterfaceMethods(content, match.index + match[0].length, startLine)
    defs.push({ name, kind: "interface", fields, line: startLine, exported: isExported })
  }

  // Step 6: extract type aliases
  const aliasRe = new RegExp(TYPE_ALIAS_RE.source, TYPE_ALIAS_RE.flags)
  while ((match = aliasRe.exec(content)) !== null) {
    const name = match[1]
    const aliasType = match[2]
    const startLine = content.slice(0, match.index).split("\n").length
    const isExported = name[0] === name[0].toUpperCase() && name[0] !== "_"
    defs.push({
      name, kind: "type", line: startLine, exported: isExported,
      fields: [{ name: "_alias", optional: false, type: aliasType, line: startLine }],
    })
  }

  return defs
}

/** Extract fields from a Go struct body. */
function extractStructFields(content: string, bodyStart: number, baseLine: number): TypeField[] {
  const fields: TypeField[] = []
  let depth = 1
  let pos = bodyStart
  while (pos < content.length && depth > 0) {
    if (content[pos] === "{") depth++
    else if (content[pos] === "}") depth--
    pos++
  }
  const body = content.slice(bodyStart, pos - 1)
  const fieldRe = new RegExp(STRUCT_FIELD_RE.source, STRUCT_FIELD_RE.flags)
  let m: RegExpExecArray | null
  while ((m = fieldRe.exec(body)) !== null) {
    const lineOffset = body.slice(0, m.index).split("\n").length - 1
    const name = m[1]
    // Skip embedded/anonymous fields (no explicit field name in Go)
    if (name[0] !== name[0].toUpperCase()) continue
    fields.push({
      name,
      optional: false, // Go structs don't have optional fields; use pointers
      type: m[2],
      line: baseLine + lineOffset,
    })
  }
  return fields
}

/** Extract methods from a Go interface body. */
function extractInterfaceMethods(content: string, bodyStart: number, baseLine: number): TypeField[] {
  const fields: TypeField[] = []
  let depth = 1
  let pos = bodyStart
  while (pos < content.length && depth > 0) {
    if (content[pos] === "{") depth++
    else if (content[pos] === "}") depth--
    pos++
  }
  const body = content.slice(bodyStart, pos - 1)
  const methodRe = new RegExp(INTERFACE_METHOD_RE.source, INTERFACE_METHOD_RE.flags)
  let m: RegExpExecArray | null
  while ((m = methodRe.exec(body)) !== null) {
    const lineOffset = body.slice(0, m.index).split("\n").length - 1
    const rest = body.slice(m.index + m[0].length).split(")")[0]
    fields.push({
      name: m[1],
      optional: false,
      type: `(${rest})`,
      line: baseLine + lineOffset,
    })
  }
  return fields
}

// ── Path normalization ──

/** Go module prefix — will be set from go.mod at runtime */
let cachedModulePrefix: string | null = null

function isLocalImport(rawPath: string): boolean {
  // Step 7: try to read go.mod for module prefix
  // For now, use heuristic: if the path contains the project's likely module name
  // Full implementation would parse go.mod
  return !rawPath.startsWith(".") && rawPath.split("/").length > 2
}

function normalizeImportPath(rawPath: string, fromFile: string, srcDir: string): string | null {
  // Step 8: strip module prefix to get project-relative package path
  // Example: "github.com/myorg/myapp/internal/service" -> "internal/service"
  // Module prefix comes from go.mod — simplified here
  const parts = rawPath.split("/")
  // Heuristic: first 3 segments are usually module prefix (github.com/org/repo)
  if (parts.length > 3) {
    const relative = parts.slice(3).join("/")
    const resolved = path.resolve(srcDir, relative)
    const rel = path.relative(srcDir, resolved)
    if (rel.startsWith("..")) return null
    return rel.replace(/\\/g, "/")
  }
  return null
}

// ── Export parser instance ──

export const goParser: Parser = {
  name: "Go",
  extensions: ["go"],
  extractImports,
  parseTypeDefs,
  isLocalImport,
  normalizeImportPath,
}