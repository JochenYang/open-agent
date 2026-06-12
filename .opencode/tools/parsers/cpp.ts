/**
 * cpp.ts — Parser plugin for C/C++
 *
 * Handles: .cpp, .cxx, .cc, .c, .hpp, .hxx, .h, .hh
 * Capabilities:
 *   - extractImports: #include directives (angle brackets and double quotes)
 *   - parseTypeDefs:  struct, class, enum, typedef, using alias
 *
 * C/C++ import resolution note:
 *   #include <header> — system/stdlib headers (not local)
 *   #include "header" — project-local headers
 *   The normalizeImportPath method resolves quoted includes relative to the file.
 *   C++ uses header files (.h/.hpp) + source files (.cpp/.cc), so a module
 *   typically spans a header-source pair.
 */

import path from "path"
import type { Parser, ImportDecl, TypeDef, TypeField } from "./types"

// ── Import extraction ──

/** #include <header> — system include */
const SYSTEM_INCLUDE_RE = /^#\s*include\s*<([^>]+)>/gm
/** #include "header" — local include */
const LOCAL_INCLUDE_RE = /^#\s*include\s*"([^"]+)"/gm

/** Extract #include directives from C/C++ source content. */
function extractImports(content: string): ImportDecl[] {
  const imports: ImportDecl[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  // Step 1: scan local includes (quoted)
  const localRe = new RegExp(LOCAL_INCLUDE_RE.source, LOCAL_INCLUDE_RE.flags)
  while ((match = localRe.exec(content)) !== null) {
    const rawPath = match[1]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = rawPath
    if (seen.has(key)) continue
    seen.add(key)

    imports.push({
      rawPath,
      isLocal: true,
      line: lineNum,
    })
  }

  // Step 2: scan system includes (angle brackets)
  const sysRe = new RegExp(SYSTEM_INCLUDE_RE.source, SYSTEM_INCLUDE_RE.flags)
  while ((match = sysRe.exec(content)) !== null) {
    const rawPath = match[1]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = `<${rawPath}>`
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

/** struct/class/enum declaration (with optional base class) */
const STRUCT_RE = /(?:^|\n)\s*(?:template\s*<[^>]+>\s*)?(?:class|struct)\s+(\w+)(?:\s*:\s*(?:public|protected|private)\s+\w+)?\s*\{/g
const ENUM_RE = /(?:^|\n)\s*(?:enum\s+)?(?:class\s+)?(?:enum\s+)?(\w+)\s*(?::\s*\w+)?\s*\{/g
const TYPEDEF_RE = /(?:^|\n)\s*typedef\s+[\w\s*<>,:]+?\s+(\w+)\s*;/g
const USING_ALIAS_RE = /(?:^|\n)\s*using\s+(\w+)\s*=\s*([^;]+);/g

/** C++ class/struct member — Type name; or Type name = value; */
const MEMBER_RE = /^\s*(?:(public|protected|private)\s+)?([\w:<>*&\[\]]+(?:\s*::\s*[\w:<>*&\[\]]+)*)\s+(\w+)\s*(?:[;=])/gm
/** Enum member: NAME = value, or NAME, */
const ENUM_MEMBER_RE = /^\s*(\w+)\s*[=,]/gm

/** Access specifiers for visibility detection */
const PUBLIC_ACCESS = new Set(["public"])

/** Parse type definitions from a C/C++ source file. */
function parseTypeDefs(content: string, filePath: string): TypeDef[] {
  const defs: TypeDef[] = []
  let match: RegExpExecArray | null

  // Step 3: extract structs and classes
  const structRe = new RegExp(STRUCT_RE.source, STRUCT_RE.flags)
  while ((match = structRe.exec(content)) !== null) {
    const name = match[1]
    const startLine = content.slice(0, match.index).split("\n").length + 1
    const isExported = isExportedType(content, match.index)
    const fields = extractCppClassFields(content, match.index + match[0].length, startLine)
    defs.push({ name, kind: "struct", fields, line: startLine, exported: isExported })
  }

  // Step 4: extract enums (including enum class)
  const enumRe = new RegExp(ENUM_RE.source, ENUM_RE.flags)
  while ((match = enumRe.exec(content)) !== null) {
    const name = match[1]
    // Skip if already captured as struct/class
    if (defs.some((d) => d.name === name)) continue
    const startLine = content.slice(0, match.index).split("\n").length + 1
    const isExported = isExportedType(content, match.index)
    const fields = extractEnumMembers(content, match.index + match[0].length, startLine)
    defs.push({ name, kind: "enum", fields, line: startLine, exported: isExported })
  }

  // Step 5: extract typedef aliases
  const typedefRe = new RegExp(TYPEDEF_RE.source, TYPEDEF_RE.flags)
  while ((match = typedefRe.exec(content)) !== null) {
    const name = match[1]
    const startLine = content.slice(0, match.index).split("\n").length + 1
    defs.push({
      name, kind: "type", line: startLine, exported: true,
      fields: [{ name: "_alias", optional: false, type: "typedef", line: startLine }],
    })
  }

  // Step 6: extract using aliases
  const usingRe = new RegExp(USING_ALIAS_RE.source, USING_ALIAS_RE.flags)
  while ((match = usingRe.exec(content)) !== null) {
    const name = match[1]
    const aliasType = match[2].trim()
    const startLine = content.slice(0, match.index).split("\n").length + 1
    defs.push({
      name, kind: "type", line: startLine, exported: true,
      fields: [{ name: "_alias", optional: false, type: aliasType, line: startLine }],
    })
  }

  return defs
}

/** Check if a type declaration is exported (not in anonymous namespace or static). */
function isExportedType(content: string, matchIndex: number): boolean {
  // Step 7: look for 'static' keyword before declaration
  const lineStart = content.lastIndexOf("\n", matchIndex) + 1
  const line = content.slice(lineStart, matchIndex).trim()
  if (line.includes("static")) return false
  // Check for anonymous namespace
  const before = content.slice(0, matchIndex)
  if (before.includes("namespace {") || before.includes("namespace{")) return false
  return true // Default: visible in header = exported
}

/** Extract fields from a C++ class/struct body (respects access specifiers). */
function extractCppClassFields(content: string, bodyStart: number, baseLine: number): TypeField[] {
  const fields: TypeField[] = []
  let depth = 1
  let pos = bodyStart
  while (pos < content.length && depth > 0) {
    if (content[pos] === "{") depth++
    else if (content[pos] === "}") depth--
    pos++
  }
  const body = content.slice(bodyStart, pos - 1)

  // Step 8: default access depends on struct (public) vs class (private)
  const declBefore = content.slice(Math.max(0, bodyStart - 200), bodyStart)
  const isStruct = /\bstruct\b\s+\w+[^{]*$/.test(declBefore)
  let currentAccess = isStruct ? "public" : "private"

  const lines = body.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Track access specifiers
    if (/^(public|protected|private)\s*:/.test(trimmed)) {
      currentAccess = trimmed.split(":")[0].trim()
      continue
    }

    // Only include public members
    if (currentAccess !== "public") continue

    // Skip methods (contain parentheses) and constructors/destructors
    if (trimmed.includes("(") || trimmed.startsWith("~") || trimmed.startsWith("//")) continue

    // Match member declaration: Type name; or Type name = value;
    const memberMatch = trimmed.match(/^([\w:<>*&\[\]]+(?:\s*::\s*[\w:<>*&\[\]]+)*)\s+(\w+)\s*[;=]/)
    if (memberMatch) {
      const type = memberMatch[1]
      const name = memberMatch[2]
      // Skip common non-field keywords
      if (["typedef", "using", "friend", "virtual", "inline", "constexpr", "static"].some((kw) => type.includes(kw))) continue
      fields.push({
        name,
        optional: false, // C++ doesn't have optional fields; use std::optional
        type,
        line: baseLine + i,
      })
    }
  }

  return fields
}

/** Extract enum members from a C/C++ enum body. */
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
    const name = m[1]
    // Skip common non-member words
    if (["class", "struct", "enum", "typedef", "using", "namespace"].includes(name)) continue
    const lineOffset = body.slice(0, m.index).split("\n").length - 1
    fields.push({ name, optional: false, type: "enum-member", line: baseLine + lineOffset })
  }
  return fields
}

// ── Path normalization ──

function isLocalImport(rawPath: string): boolean {
  // Quoted includes ("header.h") are local
  // This is already set during extraction — but we also check here
  return !rawPath.includes("/") || rawPath.endsWith(".h") || rawPath.endsWith(".hpp")
}

function normalizeImportPath(rawPath: string, fromFile: string, srcDir: string): string | null {
  // Step 9: resolve quoted include relative to the file's directory
  const dir = path.dirname(fromFile)
  const resolved = path.normalize(path.join(dir, rawPath))
  const relative = path.relative(srcDir, resolved)
  if (relative.startsWith("..")) return null
  // Strip extension for canonical key
  return relative.replace(/\\/g, "/").replace(/\.(h|hpp|hxx|hh|cpp|cxx|cc|c)$/, "")
}

// ── Export parser instance ──

export const cppParser: Parser = {
  name: "C++",
  extensions: ["cpp", "cxx", "cc", "c", "hpp", "hxx", "h", "hh"],
  extractImports,
  parseTypeDefs,
  isLocalImport,
  normalizeImportPath,
}