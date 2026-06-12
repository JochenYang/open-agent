/**
 * csharp.ts — Parser plugin for C#
 *
 * Handles: .cs
 * Capabilities:
 *   - extractImports: using directives (using X.Y.Z; / using Alias = X.Y.Z;)
 *   - parseTypeDefs:  class, struct, interface, enum, record
 *
 * C# import resolution note:
 *   C# uses namespace-based resolution, not file paths. "using" brings namespaces
 *   into scope, but the actual dependency is on types within those namespaces.
 *   For dep-graph, we treat using directives as module-level dependencies.
 *   Local imports are project-internal namespaces (matching the project's root namespace).
 */

import path from "path"
import type { Parser, ImportDecl, TypeDef, TypeField } from "./types"

// ── Import extraction ──

/** using System; / using System.Collections.Generic; / using Alias = Some.Namespace; */
const USING_RE = /^using\s+(?:(\w+)\s*=\s*)?([\w.]+)\s*;/gm
/** using static System.Math; */
const USING_STATIC_RE = /^using\s+static\s+([\w.]+)\s*;/gm

/** Extract using directives from C# source content. */
function extractImports(content: string): ImportDecl[] {
  const imports: ImportDecl[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  // Step 1: scan regular using directives
  const usingRe = new RegExp(USING_RE.source, USING_RE.flags)
  while ((match = usingRe.exec(content)) !== null) {
    const alias = match[1]
    const rawPath = match[2]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = rawPath
    if (seen.has(key)) continue
    seen.add(key)

    imports.push({
      rawPath,
      isLocal: false, // C# local detection needs project namespace — set by isLocalImport
      symbols: alias ? [alias] : undefined,
      line: lineNum,
    })
  }

  // Step 2: scan using static directives
  const staticRe = new RegExp(USING_STATIC_RE.source, USING_STATIC_RE.flags)
  while ((match = staticRe.exec(content)) !== null) {
    const rawPath = match[1]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = `static:${rawPath}`
    if (seen.has(key)) continue
    seen.add(key)

    imports.push({
      rawPath,
      isLocal: false,
      line: lineNum,
    })
  }

  return imports
}

// ── Type definition parsing ──

/** Access modifiers for visibility detection */
const ACCESS_MODIFIERS = ["public", "internal", "protected", "private"]

/** class/struct/interface/enum/record declaration */
const TYPE_DECL_RE = /(?:^|\n)\s*(?:(public|internal|protected|private)\s+)?(?:(sealed|abstract|static|partial|readonly)\s+)*(class|struct|interface|enum|record)\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*([^{]+?))?(?:\s*where\s+[^{]+)*\s*\{/g

/** Property: public Type Name { get; set; } or public Type Name { get; } */
const PROPERTY_RE = /^\s*(public|internal|protected|private)\s+([\w.<>\[\]?]+)\s+(\w+)\s*\{/gm
/** Field: public Type Name; or public Type Name = value; */
const FIELD_RE = /^\s*(public|internal|protected|private)\s+(?:readonly\s+)?([\w.<>\[\]?]+)\s+(\w+)\s*[;=]/gm
/** Enum member: Name = value, or Name, */
const ENUM_MEMBER_RE = /^\s*(\w+)\s*[=,]/gm

/** Parse type definitions from a C# source file. */
function parseTypeDefs(content: string, filePath: string): TypeDef[] {
  const defs: TypeDef[] = []
  let match: RegExpExecArray | null
  const typeRe = new RegExp(TYPE_DECL_RE.source, TYPE_DECL_RE.flags)

  while ((match = typeRe.exec(content)) !== null) {
    const access = match[1]
    const keyword = match[3] as "class" | "struct" | "interface" | "enum" | "record"
    const name = match[4]
    const bases = match[5] ? match[5].split(",").map((s) => s.trim()) : []
    const startLine = content.slice(0, match.index).split("\n").length + 1

    // Step 3: determine export visibility
    const isExported = access === "public" || !access // default is internal

    // Step 4: map C# keyword to unified kind
    let kind: TypeDef["kind"]
    switch (keyword) {
      case "class":
      case "record":
        kind = "class"
        break
      case "struct":
        kind = "struct"
        break
      case "interface":
        kind = "interface"
        break
      case "enum":
        kind = "enum"
        break
      default:
        kind = "class"
    }

    // Step 5: extract body fields
    const fields = keyword === "enum"
      ? extractEnumMembers(content, match.index + match[0].length, startLine)
      : extractCSharpTypeFields(content, match.index + match[0].length, startLine)

    defs.push({ name, kind, fields, line: startLine, exported: isExported })
  }

  return defs
}

/** Extract properties and fields from a C# type body. */
function extractCSharpTypeFields(content: string, bodyStart: number, baseLine: number): TypeField[] {
  const fields: TypeField[] = []
  let depth = 1
  let pos = bodyStart
  while (pos < content.length && depth > 0) {
    if (content[pos] === "{") depth++
    else if (content[pos] === "}") depth--
    pos++
  }
  const body = content.slice(bodyStart, pos - 1)

  // Step 6: extract properties (preferred over fields for API surface)
  const propRe = new RegExp(PROPERTY_RE.source, PROPERTY_RE.flags)
  let m: RegExpExecArray | null
  const foundProps = new Set<string>()

  while ((m = propRe.exec(body)) !== null) {
    const access = m[1]
    const type = m[2]
    const name = m[3]
    if (access !== "public") continue
    foundProps.add(name)
    const lineOffset = body.slice(0, m.index).split("\n").length - 1
    fields.push({
      name,
      optional: type.endsWith("?"),
      type: type.replace(/\?$/, ""),
      line: baseLine + lineOffset,
    })
  }

  // Step 7: extract fields (only public, not already found as properties)
  const fieldRe = new RegExp(FIELD_RE.source, FIELD_RE.flags)
  while ((m = fieldRe.exec(body)) !== null) {
    const access = m[1]
    const type = m[2]
    const name = m[3]
    if (access !== "public") continue
    if (foundProps.has(name)) continue
    const lineOffset = body.slice(0, m.index).split("\n").length - 1
    fields.push({
      name,
      optional: type.endsWith("?"),
      type: type.replace(/\?$/, ""),
      line: baseLine + lineOffset,
    })
  }

  return fields
}

/** Extract enum members from a C# enum body. */
function extractEnumMembers(content: string, bodyStart: number, baseLine: number): TypeField[] {
  const fields: TypeField[] = []
  let depth = 1
  let pos = bodyStart
  while (pos < content.length && depth > 0) {
    if (content[pos] === "{") depth++
    else if (content[pos] === "}") depth--
    pos++
  }
  const body = content.slice(bodyStart, pos - 1)
  const memberRe = new RegExp(ENUM_MEMBER_RE.source, ENUM_MEMBER_RE.flags)
  let m: RegExpExecArray | null
  while ((m = memberRe.exec(body)) !== null) {
    const lineOffset = body.slice(0, m.index).split("\n").length - 1
    fields.push({ name: m[1], optional: false, type: "enum-member", line: baseLine + lineOffset })
  }
  return fields
}

// ── Path normalization ──

function isLocalImport(rawPath: string): boolean {
  // Step 8: C# local detection — namespaces matching project root namespace
  // Heuristic: System/Microsoft prefixes are stdlib, others are potentially local
  if (rawPath.startsWith("System") || rawPath.startsWith("Microsoft")) return false
  return true // All non-stdlib namespaces are treated as potentially local
}

function normalizeImportPath(rawPath: string, fromFile: string, srcDir: string): string | null {
  // Step 9: convert namespace path to directory path heuristic
  // MyApp.Services.UserService -> Services/UserService
  // This is approximate — C# namespace != directory structure, but common convention
  const parts = rawPath.split(".")
  // Skip first 1-2 parts (typically root namespace + optional sub-namespace)
  if (parts.length <= 1) return null
  const relative = parts.slice(1).join("/")
  const resolved = path.resolve(srcDir, relative)
  const rel = path.relative(srcDir, resolved)
  if (rel.startsWith("..")) return null
  return rel.replace(/\\/g, "/")
}

// ── Export parser instance ──

export const csharpParser: Parser = {
  name: "C#",
  extensions: ["cs"],
  extractImports,
  parseTypeDefs,
  isLocalImport,
  normalizeImportPath,
}