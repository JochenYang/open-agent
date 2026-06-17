/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

// ── Constants ─────────────────────────────────

const ALLOWED_TYPES = [
  "feat", "fix", "refactor", "docs", "style",
  "test", "chore", "perf", "ci", "build", "revert",
] as const

const BRANCH_PREFIXES = ["feat", "fix", "refactor", "docs", "chore"] as const

const COMMIT_REGEX = /^(feat|fix|refactor|docs|style|test|chore|perf|ci|build|revert)(\([a-z0-9_-]+\))?: .+$/

// ── Types ─────────────────────────────────────

type Status = "pass" | "warn" | "error"

interface CheckResult {
  status: Status
  label: string
  detail: string
}

// ── Helpers ───────────────────────────────────

/** Get the first line of the commit message (the subject line) */
function getSubjectLine(msg: string): string {
  return msg.split("\n")[0]
}

/** Extract description part (strip `type(scope): ` prefix) */
function extractSubject(msg: string): string {
  return msg.replace(/^[^(]+(\([^)]+\))?:\s*/, "")
}

// ── Validators ────────────────────────────────

function checkFormat(msg: string): CheckResult {
  if (!COMMIT_REGEX.test(getSubjectLine(msg))) {
    return {
      status: "error",
      label: "Format",
      detail: "Must match `<type>(<scope>): <description>`, e.g. `feat(auth): add login flow`",
    }
  }
  return { status: "pass", label: "Format", detail: "Matches `<type>(<scope>): <description>`" }
}

function checkLength(msg: string): CheckResult {
  const line = getSubjectLine(msg)
  if (line.length > 72) {
    return {
      status: "error",
      label: "Length",
      detail: `Subject line is ${line.length} chars (hard limit <= 72)`,
    }
  }
  if (line.length > 50) {
    return {
      status: "warn",
      label: "Length",
      detail: `Subject line is ${line.length} chars (recommended <= 50)`,
    }
  }
  return {
    status: "pass",
    label: "Length",
    detail: `${line.length} chars (<= 50)`,
  }
}

function checkCase(msg: string): CheckResult {
  const subject = extractSubject(getSubjectLine(msg))
  if (!subject) {
    return { status: "warn", label: "Case", detail: "Could not extract subject" }
  }
  if (subject[0] !== subject[0].toLowerCase()) {
    return {
      status: "warn",
      label: "Case",
      detail: "Subject should start with lowercase (imperative mood, e.g. `add` not `Added`)",
    }
  }
  return { status: "pass", label: "Case", detail: "Starts with lowercase" }
}

function checkPeriod(msg: string): CheckResult {
  if (getSubjectLine(msg).endsWith(".")) {
    return { status: "warn", label: "Period", detail: "No trailing period on subject" }
  }
  return { status: "pass", label: "Period", detail: "No trailing period on subject" }
}

function checkAiSignature(msg: string): CheckResult {
  if (/co-authored-by:|claude|opencode/i.test(msg)) {
    return {
      status: "error",
      label: "AI Signature",
      detail: "Must not contain Co-Authored-By, Claude, or Opencode signatures",
    }
  }
  return { status: "pass", label: "AI Signature", detail: "No AI signature" }
}

/** Extract body part (everything after the blank line following subject) */
function extractBody(msg: string): string {
  const lines = msg.split("\n")
  if (lines.length <= 1) return ""
  let i = 1
  while (i < lines.length && lines[i].trim() === "") i++
  return lines.slice(i).join("\n")
}

function checkBodyQuality(msg: string): CheckResult {
  const body = extractBody(msg)
  if (!body) {
    return { status: "pass", label: "Body", detail: "No body (subject only)" }
  }

  const hardIssues: string[] = []
  const softIssues: string[] = []

  // Strip fenced code blocks so legitimate ``` \n ``` and code samples don't trigger false positives
  const stripped = body.replace(/```[\s\S]*?```/g, "")

  // 1. Backslash-escaped tool tokens like \ask\, \memory\, \metadata.type\
  const backslashTokens = stripped.match(/\\[A-Za-z][A-Za-z0-9_.-]*\\/g)
  if (backslashTokens && backslashTokens.length > 0) {
    const samples = [...new Set(backslashTokens.slice(0, 3))].join(", ")
    const detail = `${backslashTokens.length} backslash-escaped token(s) (e.g. ${samples}); these are tool output artifacts, not commit text`
    ;(backslashTokens.length > 5 ? hardIssues : softIssues).push(detail)
  }

  // 2. Tool invocation headers
  if (/called the (read|write|edit|glob|grep|bash|webfetch|websearch) tool/i.test(body)) {
    hardIssues.push("contains 'Called the <X> tool' header (tool invocation leak)")
  }

  // 3. Tool metadata keywords
  if (/\b(filePath|tool_call|tool result:|tooluse_|tool_use_id)\b/i.test(body)) {
    hardIssues.push("contains tool metadata keywords (filePath / tool_use_id / tool result)")
  }

  // 4. Raw JSON argument blocks (e.g. {"filePath":"...","limit":...})
  if (/\{\s*"(?:filePath|path|command|content)":/i.test(body)) {
    hardIssues.push("contains raw JSON argument block (e.g. {\"filePath\":...})")
  }

  // 5. Body line count
  const bodyLines = body.split("\n").filter(l => l.trim() !== "")
  if (bodyLines.length > 20) {
    hardIssues.push(`body has ${bodyLines.length} non-empty lines (hard limit <= 20, recommended <= 15)`)
  } else if (bodyLines.length > 15) {
    softIssues.push(`body has ${bodyLines.length} non-empty lines (recommended <= 15)`)
  }

  // 6. Per-line length (skip fenced code lines)
  const longLines = bodyLines.filter(l => !l.startsWith("```") && l.length > 72)
  if (longLines.length > 0) {
    const maxLen = Math.max(...longLines.map(l => l.length))
    const detail = `${longLines.length} line(s) exceed 72 chars (max: ${maxLen})`
    ;(longLines.length > 5 ? hardIssues : softIssues).push(detail)
  }

  // 7. Body should be primarily bullets (fead286d reference style).
  // All-prose with multiple lines => ERROR (force conversion).
  // Prose-dominant => WARN.
  const bulletLines = bodyLines.filter(l => l.startsWith("- ") || l.startsWith("* ")).length
  const proseLines = bodyLines.filter(l => !l.startsWith("```") && !l.startsWith("- ") && !l.startsWith("* ")).length
  if (bulletLines === 0 && proseLines >= 3) {
    hardIssues.push(`body is all prose (${proseLines} lines, 0 bullets); convert each logical change to a bullet line (<verb> <short noun phrase>)`)
  } else if (proseLines > bulletLines && proseLines > 2) {
    softIssues.push(`body has ${proseLines} prose line(s) vs ${bulletLines} bullet(s); prefer bullet format per fead286d style`)
  }

  if (hardIssues.length > 0) {
    return { status: "error", label: "Body", detail: [...hardIssues, ...softIssues].join("; ") }
  }
  if (softIssues.length > 0) {
    return { status: "warn", label: "Body", detail: softIssues.join("; ") }
  }
  return { status: "pass", label: "Body", detail: "Clean body, within size limits" }
}

function checkBranch(branch: string): CheckResult {
  const valid = BRANCH_PREFIXES.some(p => branch.startsWith(`${p}/`))
  if (!valid) {
    return {
      status: "warn",
      label: "Branch Name",
      detail: `Use a standard prefix: ${BRANCH_PREFIXES.map(p => `${p}/<name>`).join(", ")}`,
    }
  }
  return { status: "pass", label: "Branch Name", detail: `Prefix matches convention` }
}

// ── Guide builder ─────────────────────────────

function buildGuide(files?: string[]): string {
  const sections: string[] = [
    "",
    "======== Git Convention Guide ========",
    "",
    "[Commit Format]",
    "  <type>(<scope>): <subject>",
    "",
    "  <blank line>",
    "  <body>",
    "",
    `  Allowed types: ${ALLOWED_TYPES.join(", ")}`,
    "",
    "[Commit Rules]",
    "  - Use English only (unless the user specifies a different language)",
    "  - Imperative mood (add, fix, update -- not added, fixed, updated)",
    "  - Subject starts with lowercase",
    "  - Subject line <= 72 chars (recommended <= 50)",
    "  - Subject line = `<type>(<scope>): <description>`, length counts the whole line",
    "  - No trailing period",
    "  - No AI signature or Co-Authored-By",
    "",
    "[Scope Rules]",
    "  - Scope is optional; add it when the change is specific to a module/area",
    "  - Use lowercase kebab-case or snake_case, e.g. `auth`, `api`, `user-profile`",
    "  - The scope appears in parens: `fix(auth): handle null token`",
    "",
    "[Body Rules]",
    "  - Blank line between subject and body",
    "  - Each line <= 72 chars",
    "  - Body MUST be primarily bullets; all-prose body is an ERROR",
    "  - A short prose lead-in (<= 2 lines) is OK to explain context or BREAKING CHANGE",
    "  - If prose lines > bullet lines (> 2 prose), it's a WARN: convert to bullets",
    "  - Bullet format: <verb> <short noun phrase>, no trailing punctuation",
    "  - Each bullet describes one logical change in plain prose",
    "  - Body <= 15 lines; split into multiple commits if longer",
    "",
    "[Body Example -- reference commit fead286d]",
    "  feat: add layout spacing, improve README, and add LICENSE",
    "  ",
    "  - Add py-8 spacing between header and test form",
    "  - Simplify README header design with centered layout",
    "  - Add bilingual README links (English/Chinese)",
    "  - Add MIT LICENSE file",
    "  - Sync README_CN with English version updates",
    "",
    "[Body Hygiene -- NEVER paste raw tool output]",
    "  - No backslash-escaped tokens (\\ask\\, \\memory\\)",
    "  - No 'Called the Read tool...' headers",
    "  - No raw JSON arg blocks ({\"filePath\":...})",
    "  - No tool metadata (filePath, tool_use_id, tool result:)",
    "  - Summarize in plain prose; never copy-paste verbatim",
    "",
    "[Commit Workflow]",
    "  1. Show the proposed commit message",
    "  2. Wait for user confirmation before committing",
    "  3. Allow user to edit or skip",
    "",
    "[Pre-Commit Checklist -- requires manual verification]",
    "  [ ] No secret leakage (check .env, config, tokens)",
    "  [ ] Tests pass",
    "  [ ] Lint / Format pass",
    "  [ ] Scope is focused (no unrelated changes)",
    "",
    "[Branch Naming]",
    `  ${BRANCH_PREFIXES.map(p => `${p}/<name>`).join(", ")}`,
    "",
    "[PR Rules]",
    "  - Keep PRs small and focused",
    "  - Include tests for behavior changes",
    "  - Update docs for externally visible changes",
    "  - Link related issue / task",
    "",
  ]

  // Output contract
  sections.push(
    "[Git Proposal Output Contract]",
    "When proposing Git actions, always provide:",
    "",
    "  1. Proposed branch name",
    "  2. Commit message (subject + optional body summary)",
    "  3. Changed files summary" + (files && files.length > 0
      ? "\n" + files.map(f => `     - ${f}`).join("\n")
      : " (pass file list to generate)"),
    "  4. Clear confirmation question (y/n)",
    "",
    "========================================",
    "",
  )

  return sections.join("\n")
}

/** Format check results as markdown */
function formatResults(checks: CheckResult[]): string {
  const pass = checks.filter(c => c.status === "pass")
  const warns = checks.filter(c => c.status === "warn")
  const errs = checks.filter(c => c.status === "error")

  const lines: string[] = []
  if (pass.length > 0) {
    lines.push("**Auto checks passed**")
    pass.forEach(c => lines.push(`  PASS  ${c.label}: ${c.detail}`))
    lines.push("")
  }
  if (warns.length > 0) {
    lines.push("**Needs manual verification**")
    warns.forEach(c => lines.push(`  WARN  ${c.label}: ${c.detail}`))
    lines.push("")
  }
  if (errs.length > 0) {
    lines.push("**Must fix before commit**")
    errs.forEach(c => lines.push(`  ERROR ${c.label}: ${c.detail}`))
    lines.push("")
  }
  return lines.join("\n")
}

// ── Tool Definition ───────────────────────────

export default tool({
  description: `Validate git commit messages and return the full Git convention guide.

Call this tool when the user asks to commit code, create a branch, or open a PR.

What it does:
  - Validates commit message format (type, scope, length, case, period, AI signature)
  - Validates branch naming convention
  - Returns full Git convention guide (format rules, workflow, body rules, pre-commit checklist, output contract)

How to use:
  - During commit: pass message + branch + files, returns validation results + convention guide
  - View conventions only: call with no args, returns the full guide
  - This tool does NOT generate message content -- only validates and guides`,

  args: {
    message: tool.schema
      .string()
      .describe("Proposed commit message (subject + optional body)")
      .optional(),
    branch: tool.schema
      .string()
      .describe("Current branch name")
      .optional(),
    files: tool.schema
      .array(tool.schema.string())
      .describe("List of changed file paths")
      .optional(),
  },

  async execute(args) {
    const output: string[] = []
    let allPass = true

    // ── Run validations ──
    const checks: CheckResult[] = []

    if (args.message) {
      checks.push(checkFormat(args.message))
      checks.push(checkLength(args.message))
      checks.push(checkCase(args.message))
      checks.push(checkPeriod(args.message))
      checks.push(checkAiSignature(args.message))
      checks.push(checkBodyQuality(args.message))
    }

    if (args.branch) {
      checks.push(checkBranch(args.branch))
    }

    // ── Output validation results ──
    if (checks.length > 0) {
      output.push(formatResults(checks))
      allPass = checks.every(c => c.status !== "error")
    }

    // ── Correction examples if errors found ──
    if (args.message && !allPass) {
      output.push("**Correct examples:**")
      output.push("  feat(auth): add login flow")
      output.push("  fix(api): handle null pointer in response parser")
      output.push("  docs(readme): update install instructions")
      output.push("")
    }

    // ── Always append convention guide ──
    output.push(buildGuide(args.files))

    return output.join("\n")
  },
})
