/**
 * rust.ts — Parser plugin for Rust
 *
 * Handles: .rs
 * Capabilities:
 *   - extractImports: use paths, extern crate, mod declarations
 *   - parseTypeDefs:  struct, enum, trait, type alias
 *
 * Rust import resolution note:
 *   Rust uses "use" to bring paths into scope. The crate root is lib.rs/main.rs.
 *   Local imports start with "crate::", "super::", "self::", or a local module name.
 *   The normalizeImportPath method handles crate:: prefix stripping.
 */

import path from "path"
import type { Parser, ImportDecl, TypeDef, TypeField } from "./types"

// ── Import extraction ──

/** use path::to::item; / use path::to::{item1, item2}; / use path::*; */
const USE_RE = /^use\s+([\w:]+(?:::\{[\w,\s]+\}|::\*)?)\s*;/gm
/** mod name; / mod name { ... } */
const MOD_RE = /^mod\s+(\w+)\s*[;{]/gm
/** extern crate name; */
const EXTERN_CRATE_RE = /^extern\s+crate\s+(\w+)\s*;/gm

/** Extract use/mod/extern declarations from Rust source content. */
function extractImports(content: string): ImportDecl[] {
  const imports: ImportDecl[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  // Step 1: scan use statements
  const useRe = new RegExp(USE_RE.source, USE_RE.flags)
  while ((match = useRe.exec(content)) !== null) {
    const rawPath = match[1]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = rawPath
    if (seen.has(key)) continue
    seen.add(key)

    // Extract symbols from grouped imports: use foo::{bar, baz}
    let symbols: string[] | undefined
    const groupMatch = rawPath.match(/::\{(.+)\}$/)
    if (groupMatch) {
      symbols = groupMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
    } else if (rawPath.endsWith("::*")) {
      symbols = ["*"] // glob import
    }

    const basePath = rawPath.replace(/::\{.+\}$/, "").replace(/::\*$/, "")

    imports.push({
      rawPath: basePath,
      isLocal: isLocalImport(basePath),
      symbols,
      line: lineNum,
    })
  }

  // Step 2: scan mod declarations (local module references)
  const modRe = new RegExp(MOD_RE.source, MOD_RE.flags)
  while ((match = modRe.exec(content)) !== null) {
    const name = match[1]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = `mod:${name}`
    if (seen.has(key)) continue
    seen.add(key)

    imports.push({
      rawPath: name,
      isLocal: true, // mod always refers to a local module
      symbols: undefined,
      line: lineNum,
    })
  }

  // Step 3: scan extern crate (external dependencies)
  const externRe = new RegExp(EXTERN_CRATE.source, EXTERN_CRATE_RE.flags)
  while ((match = externRe.exec(content)) !== null) {
    const name = match[1]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = `extern:${name}`
    if (seen.has(key)) continue
    seen.add(key)

    imports.push({
      rawPath: name,
      isLocal: false, // extern crate is always external
      line: lineNum,
    })
  }

  return imports
}

// ── Type definition parsing ──

const STRUCT_RE = /(?:pub\s+)?struct\s+(\w+)(?:<[^>]+>)?\s*[\{(]/g
const ENUM_RE = /(?:pub\s+)?enum\s+(\w+)(?:<[^>]+>)?\s*\{/g
const TRAIT_RE = /(?:pub\s+)?trait\s+(\w+)(?:<[^>]+>)?(?::\s+[^{]+)?\s*\{/g
const TYPE_ALIAS_RE = /(?:pub\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=\s*([^;]+);/g

/** Rust struct field: name: Type, or pub name: Type, */
const STRUCT_FIELD_RE = /(?:(pub)\s+)?(\w+)\s*:\s*([^,}]+)/g
/** Rust enum variant: Name or Name(Type) or Name { fields } */
const ENUM_VARIANT_RE = /(\w+)(?:\s*[\({]|\s*,|\s*$)/gm

/** Parse type definitions from a Rust source file. */
function parseTypeDefs(content: string, filePath: string): TypeDef[] {
  const defs: TypeDef[] = []
  let match: RegExpExecArray | null

  // Step 4: extract structs
  const structRe = new RegExp(STRUCT_RE.source, STRUCT_RE.flags)
  while ((match = structRe.exec(content)) !== null) {
    const name = match[1]
    const startLine = content.slice(0, match.index).split("\n").length
    const isExported = match[0].trimStart().startsWith("pub")
    const fields = extractStructFields(content, match.index + match[0].length, startLine)
    defs.push({ name, kind: "struct", fields, line: startLine, exported: isExported })
  }

  // Step 5: extract enums
  const enumRe = new RegExp(ENUM_RE.source, ENUM_RE.flags)
  while ((match = enumRe.exec(content)) !== null) {
    const name = match[1]
    const startLine = content.slice(0, match.index).split("\n").length
    const isExported = match[0].trimStart().startsWith("pub")
    const fields = extractEnumVariants(content, match.index + match[0].length, startLine)
    defs.push({ name, kind: "enum", fields, line: startLine, exported: isExported })
  }

  // Step 6: extract traits
  const traitRe = new RegExp(TRAIT_RE.source, TRAIT_RE.flags)
  while ((match = traitRe.exec(content)) !== null) {
    const name = match[1]
    const startLine = content.slice(0, match.index).split("\n").length
    const isExported = match[0].trimStart().startsWith("pub")
    defs.push({ name, kind: "interface", fields: [], line: startLine, exported: isExported })
  }

  // Step 7: extract type aliases
  const aliasRe = new RegExp(TYPE_ALIAS_RE.source, TYPE_ALIAS_RE.flags)
  while ((match = aliasRe.exec(content)) !== null) {
    const name = match[1]
    const aliasType = match[2].trim()
    const startLine = content.slice(0, match.index).split("\n").length
    const isExported = match[0].trimStart().startsWith("pub")
    defs.push({
      name, kind: "type", line: startLine, exported: isExported,
      fields: [{ name: "_alias", optional: false, type: aliasType, line: startLine }],
    })
  }

  return defs
}

/** Extract fields from a Rust struct body. */
function extractStructFields(content: string, bodyStart: number, baseLine: number): TypeField[] {
  const fields: TypeField[] = []
  let depth = 1
  let pos = bodyStart

  // Handle both { and ( tuple structs
  const openChar = content[bodyStart - 1]
  const closeChar = openChar === "(" ? ")" : "}"

  while (pos < content.length && depth > 0) {
    if (content[pos] === openChar || content[pos] === "{") depth++
    else if (content[pos] === closeChar || content[pos] === "}") depth--
    pos++
  }
  const body = content.slice(bodyStart, pos - 1)
  const fieldRe = new RegExp(STRUCT_FIELD_RE.source, STRUCT_FIELD_RE.flags)
  let m: RegExpExecArray | null
  while ((m = fieldRe.exec(body)) !== null) {
    const isPub = m[1] === "pub"
    const name = m[2]
    const type = m[3].trim().replace(/,\s*$/, "")
    if (name === "_") continue // phantom data etc.
    const lineOffset = body.slice(0, m.index).split("\n").length - 1
    fields.push({
      name,
      optional: type.startsWith("Option<"),
      type,
      line: baseLine + lineOffset,
    })
  }
  return fields
}

/** Extract variants from a Rust enum body. */
function extractEnumVariants(content: string, bodyStart: number, baseLine: number): TypeField[] {
  const fields: TypeField[] = []
  let depth = 1
  let pos = bodyStart
  while (pos < content.length && depth > 0) {
    if (content[pos] === "{") depth++
    else if (content[pos] === "}") depth--
    pos++
  }
  const body = content.slice(bodyStart, pos - 1)
  const variantRe = new RegExp(ENUM_VARIANT_RE.source, ENUM_VARIANT_RE.flags)
  let m: RegExpExecArray | null
  while ((m = variantRe.exec(body)) !== null) {
    const name = m[1]
    // Skip common non-variant words
    if (["pub", "fn", "impl", "const", "type", "where"].includes(name)) continue
    const lineOffset = body.slice(0, m.index).split("\n").length - 1
    fields.push({ name, optional: false, type: "enum-variant", line: baseLine + lineOffset })
  }
  return fields
}

// ── Path normalization ──

function isLocalImport(rawPath: string): boolean {
  // Step 8: crate:: / super:: / self:: are always local
  if (rawPath.startsWith("crate::") || rawPath.startsWith("super::") || rawPath.startsWith("self::")) {
    return true
  }
  // std / core / alloc are stdlib
  if (["std", "core", "alloc", "proc_macro"].includes(rawPath.split("::")[0])) {
    return false
  }
  // Otherwise likely an external crate dependency
  return false
}

function normalizeImportPath(rawPath: string, fromFile: string, srcDir: string): string | null {
  let modulePath: string

  if (rawPath.startsWith("crate::")) {
    // Step 9: strip crate:: prefix -> project-relative path
    modulePath = rawPath.slice("crate::".length).replace(/::/g, "/")
  } else if (rawPath.startsWith("super::")) {
    // Go up one level from current file
    const fileDir = fromFile.replace(/\\/g, "/").replace(/\/[^/]+\.rs$/, "")
    const parentDir = fileDir.replace(/\/[^/]+$/, "")
    const rest = rawPath.slice("super::".length).replace(/::/g, "/")
    modulePath = parentDir ? `${parentDir}/${rest}` : rest
  } else if (rawPath.startsWith("self::")) {
    const fileDir = fromFile.replace(/\\/g, "/").replace(/\/[^/]+\.rs$/, "")
    const rest = rawPath.slice("self::".length).replace(/::/g, "/")
    modulePath = `${fileDir}/${rest}`
  } else {
    // External or local module name
    return null
  }

  const resolved = path.resolve(srcDir, modulePath)
  const relative = path.relative(srcDir, resolved)
  if (relative.startsWith("..")) return null
  return relative.replace(/\\/g, "/")
}

// ── Export parser instance ──

export const rustParser: Parser = {
  name: "Rust",
  extensions: ["rs"],
  extractImports,
  parseTypeDefs,
  isLocalImport,
  normalizeImportPath,
}