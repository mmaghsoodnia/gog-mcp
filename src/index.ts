import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const GOG_PATH = process.env.GOG_PATH || "/opt/homebrew/bin/gog";
const DEFAULT_ACCOUNT = process.env.GOG_ACCOUNT || "";

async function runGog(
  args: string[],
  account?: string
): Promise<string> {
  const fullArgs: string[] = [];
  const effectiveAccount = account || DEFAULT_ACCOUNT;
  if (effectiveAccount) fullArgs.push("--account", effectiveAccount);
  fullArgs.push("--json", "--no-input");
  fullArgs.push(...args);

  const { stdout, stderr } = await execFileAsync(GOG_PATH, fullArgs, {
    env: process.env,
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  // gog writes data to stdout, warnings to stderr
  if (stderr && !stdout) return stderr;
  return stdout;
}

// Helper: write text to a temp file, run callback, clean up
async function withTempFile(
  content: string,
  fn: (path: string) => Promise<string>
): Promise<string> {
  const path = join(tmpdir(), `gog-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await writeFile(path, content, "utf-8");
  try {
    return await fn(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

const accountParam = z
  .string()
  .optional()
  .describe("Google account email (overrides GOG_ACCOUNT env var)");

// ---------- Server ----------

const server = new McpServer({
  name: "gog",
  version: "1.0.0",
});

// ========== META ==========

server.tool(
  "gog_status",
  "Check gog authentication status and list authenticated accounts",
  { account: accountParam },
  async ({ account }) => {
    const status = await runGog(["auth", "status"], account);
    const list = await runGog(["auth", "list"], account);
    return text(`Status:\n${status}\n\nAccounts:\n${list}`);
  }
);

server.tool(
  "gog_raw",
  "Execute any gog command not covered by specific tools. Pass args as an array.",
  {
    args: z.array(z.string()).describe('gog command arguments (e.g. ["slides", "info", "PRESENTATION_ID"])'),
    account: accountParam,
  },
  async ({ args, account }) => text(await runGog(args, account))
);

// ========== GMAIL ==========

server.tool(
  "gmail_search",
  "Search Gmail threads using Gmail query syntax. Returns one row per thread.",
  {
    query: z.string().describe('Gmail search query (e.g. "newer_than:7d", "from:alice@example.com is:unread")'),
    max: z.number().optional().default(10).describe("Maximum threads to return"),
    account: accountParam,
  },
  async ({ query, max, account }) =>
    text(await runGog(["gmail", "search", query, "--max", String(max)], account))
);

server.tool(
  "gmail_messages_search",
  "Search individual Gmail messages (ignores threading). Use when you need every email separately.",
  {
    query: z.string().describe("Gmail search query"),
    max: z.number().optional().default(20).describe("Maximum messages to return"),
    account: accountParam,
  },
  async ({ query, max, account }) =>
    text(await runGog(["gmail", "messages", "search", query, "--max", String(max)], account))
);

server.tool(
  "gmail_get",
  "Get a specific Gmail message by ID",
  {
    message_id: z.string().describe("Gmail message ID"),
    account: accountParam,
  },
  async ({ message_id, account }) =>
    text(await runGog(["gmail", "get", message_id], account))
);

server.tool(
  "gmail_send",
  "Send an email. Use body for short text, body_html for HTML. For multi-line plain text, provide the full text in body.",
  {
    to: z.string().describe("Recipient email address(es), comma-separated"),
    subject: z.string().describe("Email subject"),
    body: z.string().optional().describe("Plain text body"),
    body_html: z.string().optional().describe("HTML body (overrides body if both set)"),
    cc: z.string().optional().describe("CC recipients, comma-separated"),
    bcc: z.string().optional().describe("BCC recipients, comma-separated"),
    reply_to_message_id: z.string().optional().describe("Message ID to reply to (makes this a reply)"),
    account: accountParam,
  },
  async ({ to, subject, body, body_html, cc, bcc, reply_to_message_id, account }) => {
    if (body_html) {
      const args = ["gmail", "send", "--to", to, "--subject", subject, "--body-html", body_html];
      if (cc) args.push("--cc", cc);
      if (bcc) args.push("--bcc", bcc);
      if (reply_to_message_id) args.push("--reply-to-message-id", reply_to_message_id);
      return text(await runGog(args, account));
    }

    const content = body || "";
    // Use temp file for body to handle multi-line text properly
    return text(
      await withTempFile(content, async (path) => {
        const args = ["gmail", "send", "--to", to, "--subject", subject, "--body-file", path];
        if (cc) args.push("--cc", cc);
        if (bcc) args.push("--bcc", bcc);
        if (reply_to_message_id) args.push("--reply-to-message-id", reply_to_message_id);
        return runGog(args, account);
      })
    );
  }
);

server.tool(
  "gmail_draft_create",
  "Create a Gmail draft",
  {
    to: z.string().describe("Recipient email address(es)"),
    subject: z.string().describe("Email subject"),
    body: z.string().optional().describe("Plain text body"),
    body_html: z.string().optional().describe("HTML body"),
    account: accountParam,
  },
  async ({ to, subject, body, body_html, account }) => {
    if (body_html) {
      return text(
        await runGog(
          ["gmail", "drafts", "create", "--to", to, "--subject", subject, "--body-html", body_html],
          account
        )
      );
    }
    return text(
      await withTempFile(body || "", async (path) =>
        runGog(
          ["gmail", "drafts", "create", "--to", to, "--subject", subject, "--body-file", path],
          account
        )
      )
    );
  }
);

server.tool(
  "gmail_draft_send",
  "Send an existing Gmail draft by its draft ID",
  {
    draft_id: z.string().describe("Draft ID to send"),
    account: accountParam,
  },
  async ({ draft_id, account }) =>
    text(await runGog(["gmail", "drafts", "send", draft_id], account))
);

// ========== CALENDAR ==========

server.tool(
  "calendar_events",
  "List calendar events in a date range",
  {
    calendar_id: z.string().optional().default("primary").describe("Calendar ID (default: primary)"),
    from: z.string().describe("Start date/time in ISO 8601 format"),
    to: z.string().describe("End date/time in ISO 8601 format"),
    account: accountParam,
  },
  async ({ calendar_id, from, to, account }) =>
    text(await runGog(["calendar", "events", calendar_id, "--from", from, "--to", to], account))
);

server.tool(
  "calendar_create",
  "Create a calendar event",
  {
    calendar_id: z.string().optional().default("primary").describe("Calendar ID"),
    summary: z.string().describe("Event title"),
    from: z.string().describe("Start date/time in ISO 8601"),
    to: z.string().describe("End date/time in ISO 8601"),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    event_color: z.number().optional().describe("Event color ID (1-11). Use gog_raw with 'calendar colors' to see options"),
    account: accountParam,
  },
  async ({ calendar_id, summary, from, to, description, location, event_color, account }) => {
    const args = ["calendar", "create", calendar_id, "--summary", summary, "--from", from, "--to", to];
    if (description) args.push("--description", description);
    if (location) args.push("--location", location);
    if (event_color) args.push("--event-color", String(event_color));
    return text(await runGog(args, account));
  }
);

server.tool(
  "calendar_update",
  "Update an existing calendar event",
  {
    calendar_id: z.string().optional().default("primary").describe("Calendar ID"),
    event_id: z.string().describe("Event ID to update"),
    summary: z.string().optional().describe("New title"),
    from: z.string().optional().describe("New start time"),
    to: z.string().optional().describe("New end time"),
    description: z.string().optional().describe("New description"),
    location: z.string().optional().describe("New location"),
    event_color: z.number().optional().describe("New color ID (1-11)"),
    account: accountParam,
  },
  async ({ calendar_id, event_id, summary, from, to, description, location, event_color, account }) => {
    const args = ["calendar", "update", calendar_id, event_id];
    if (summary) args.push("--summary", summary);
    if (from) args.push("--from", from);
    if (to) args.push("--to", to);
    if (description) args.push("--description", description);
    if (location) args.push("--location", location);
    if (event_color) args.push("--event-color", String(event_color));
    return text(await runGog(args, account));
  }
);

server.tool(
  "calendar_delete",
  "Delete a calendar event",
  {
    calendar_id: z.string().optional().default("primary").describe("Calendar ID"),
    event_id: z.string().describe("Event ID to delete"),
    account: accountParam,
  },
  async ({ calendar_id, event_id, account }) =>
    text(await runGog(["calendar", "delete", calendar_id, event_id], account))
);

server.tool(
  "calendar_search",
  "Search calendar events by text query",
  {
    calendar_id: z.string().optional().default("primary").describe("Calendar ID"),
    query: z.string().describe("Search text"),
    from: z.string().optional().describe("Start date for search range"),
    to: z.string().optional().describe("End date for search range"),
    account: accountParam,
  },
  async ({ calendar_id, query, from, to, account }) => {
    const args = ["calendar", "events", calendar_id, "--query", query];
    if (from) args.push("--from", from);
    if (to) args.push("--to", to);
    return text(await runGog(args, account));
  }
);

// ========== DRIVE ==========

server.tool(
  "drive_ls",
  "List files in Google Drive. Optionally filter by folder.",
  {
    folder_id: z.string().optional().describe("Folder ID to list (omit for root)"),
    account: accountParam,
  },
  async ({ folder_id, account }) => {
    const args = ["drive", "ls"];
    if (folder_id) args.push("--folder", folder_id);
    return text(await runGog(args, account));
  }
);

server.tool(
  "drive_search",
  "Search Google Drive files by query",
  {
    query: z.string().describe("Search query"),
    max: z.number().optional().default(10).describe("Maximum results"),
    account: accountParam,
  },
  async ({ query, max, account }) =>
    text(await runGog(["drive", "search", query, "--max", String(max)], account))
);

server.tool(
  "drive_upload",
  "Upload a local file to Google Drive",
  {
    file_path: z.string().describe("Local file path to upload"),
    parent_id: z.string().optional().describe("Parent folder ID"),
    account: accountParam,
  },
  async ({ file_path, parent_id, account }) => {
    const args = ["drive", "upload", file_path];
    if (parent_id) args.push("--parent", parent_id);
    return text(await runGog(args, account));
  }
);

server.tool(
  "drive_download",
  "Download a file from Google Drive",
  {
    file_id: z.string().describe("File ID to download"),
    output_path: z.string().describe("Local output path"),
    account: accountParam,
  },
  async ({ file_id, output_path, account }) =>
    text(await runGog(["drive", "download", file_id, "--out", output_path], account))
);

server.tool(
  "drive_mkdir",
  "Create a folder in Google Drive",
  {
    name: z.string().describe("Folder name"),
    parent_id: z.string().optional().describe("Parent folder ID"),
    account: accountParam,
  },
  async ({ name, parent_id, account }) => {
    const args = ["drive", "mkdir", name];
    if (parent_id) args.push("--parent", parent_id);
    return text(await runGog(args, account));
  }
);

server.tool(
  "drive_rename",
  "Rename a file or folder in Google Drive",
  {
    file_id: z.string().describe("File ID to rename"),
    new_name: z.string().describe("New name for the file or folder"),
    account: accountParam,
  },
  async ({ file_id, new_name, account }) =>
    text(await runGog(["drive", "rename", file_id, new_name], account))
);

server.tool(
  "drive_delete",
  "Move a file to trash (or permanently delete with permanent flag)",
  {
    file_id: z.string().describe("File ID to delete"),
    permanent: z.boolean().optional().default(false).describe("Permanently delete instead of moving to trash"),
    account: accountParam,
  },
  async ({ file_id, permanent, account }) => {
    const args = ["drive", "delete", file_id, "--force"];
    if (permanent) args.push("--permanent");
    return text(await runGog(args, account));
  }
);

server.tool(
  "drive_move",
  "Move a file to a different folder in Google Drive",
  {
    file_id: z.string().describe("File ID to move"),
    parent_id: z.string().describe("New parent folder ID"),
    account: accountParam,
  },
  async ({ file_id, parent_id, account }) =>
    text(await runGog(["drive", "move", file_id, "--parent", parent_id], account))
);

server.tool(
  "drive_share",
  "Share a file or folder in Google Drive. Use --to anyone to make a file publicly readable (required before using its URL in docs_find_replace for image insertion).",
  {
    file_id: z.string().describe("File ID to share"),
    to: z.enum(["anyone", "user", "domain"]).describe("Share target: anyone (public), user (specific email), or domain"),
    email: z.string().optional().describe("User email (required when to=user)"),
    domain: z.string().optional().describe("Domain (required when to=domain, e.g. example.com)"),
    role: z.enum(["reader", "writer"]).optional().default("reader").describe("Permission level"),
    account: accountParam,
  },
  async ({ file_id, to, email, domain, role, account }) => {
    const args = ["drive", "share", file_id, "--to", to, "--role", role ?? "reader", "--force"];
    if (email) args.push("--email", email);
    if (domain) args.push("--domain", domain);
    return text(await runGog(args, account));
  }
);

// ========== DOCS ==========

server.tool(
  "docs_cat",
  "Read a Google Doc's content as plain text",
  {
    doc_id: z.string().describe("Google Doc ID"),
    account: accountParam,
  },
  async ({ doc_id, account }) =>
    text(await runGog(["docs", "cat", doc_id], account))
);

server.tool(
  "docs_create",
  "Create a new Google Doc, optionally with initial content from a markdown string",
  {
    title: z.string().describe("Document title"),
    content: z.string().optional().describe("Initial content (markdown supported)"),
    parent_id: z.string().optional().describe("Parent Drive folder ID"),
    account: accountParam,
  },
  async ({ title, content, parent_id, account }) => {
    if (content) {
      return text(
        await withTempFile(content, async (path) => {
          const args = ["docs", "create", title, "--file", path];
          if (parent_id) args.push("--parent", parent_id);
          return runGog(args, account);
        })
      );
    }
    const args = ["docs", "create", title];
    if (parent_id) args.push("--parent", parent_id);
    return text(await runGog(args, account));
  }
);

server.tool(
  "docs_write",
  "Replace all content in a Google Doc",
  {
    doc_id: z.string().describe("Google Doc ID"),
    content: z.string().describe("New content (replaces everything)"),
    account: accountParam,
  },
  async ({ doc_id, content, account }) =>
    text(
      await withTempFile(content, async (path) =>
        runGog(["docs", "write", doc_id, "--file", path], account)
      )
    )
);

server.tool(
  "docs_update",
  "Update a Google Doc with content and optional formatting (font, color, alignment). Supports markdown and plain text.",
  {
    doc_id: z.string().describe("Google Doc ID"),
    content: z.string().describe("Content to write (markdown or plain text)"),
    format: z.enum(["plain", "markdown"]).optional().default("markdown").describe("Content format"),
    append: z.boolean().optional().default(false).describe("Append instead of replacing all content"),
    font_family: z.string().optional().describe("Font family (e.g. Arial, Georgia, Times New Roman)"),
    font_size: z.number().optional().describe("Font size in points (e.g. 12, 14, 16)"),
    text_color: z.string().optional().describe("Text color as hex (#RRGGBB)"),
    bg_color: z.string().optional().describe("Background highlight color as hex (#RRGGBB)"),
    alignment: z.enum(["left", "center", "right", "justified"]).optional().describe("Paragraph alignment"),
    underline: z.boolean().optional().describe("Apply underline"),
    strikethrough: z.boolean().optional().describe("Apply strikethrough"),
    line_spacing: z.number().optional().describe("Line spacing percentage (e.g. 150 = 1.5x)"),
    account: accountParam,
  },
  async ({ doc_id, content, format, append, font_family, font_size, text_color, bg_color, alignment, underline, strikethrough, line_spacing, account }) =>
    text(
      await withTempFile(content, async (path) => {
        const args = ["docs", "update", doc_id, "--content-file", path, "--format", format ?? "markdown"];
        if (append) args.push("--append");
        if (font_family) args.push("--font-family", font_family);
        if (font_size) args.push("--font-size", String(font_size));
        if (text_color) args.push("--text-color", text_color);
        if (bg_color) args.push("--bg-color", bg_color);
        if (alignment) args.push("--alignment", alignment);
        if (underline) args.push("--underline");
        if (strikethrough) args.push("--strikethrough");
        if (line_spacing) args.push("--line-spacing", String(line_spacing));
        return runGog(args, account);
      })
    )
);

server.tool(
  "docs_format",
  "Apply formatting to existing text in a Google Doc. Use --match to target specific text, or omit to format the entire document.",
  {
    doc_id: z.string().describe("Google Doc ID"),
    match: z.string().optional().describe("Text to find and format (first occurrence)"),
    match_all: z.boolean().optional().default(false).describe("Format all occurrences of match text"),
    font_family: z.string().optional().describe("Font family (e.g. Arial, Georgia)"),
    font_size: z.number().optional().describe("Font size in points"),
    text_color: z.string().optional().describe("Text color as hex (#RRGGBB)"),
    bg_color: z.string().optional().describe("Background highlight color as hex (#RRGGBB)"),
    bold: z.boolean().optional().describe("Apply bold"),
    italic: z.boolean().optional().describe("Apply italic"),
    underline: z.boolean().optional().describe("Apply underline"),
    strikethrough: z.boolean().optional().describe("Apply strikethrough"),
    alignment: z.enum(["left", "center", "right", "justified"]).optional().describe("Paragraph alignment"),
    line_spacing: z.number().optional().describe("Line spacing percentage (e.g. 150 = 1.5x)"),
    account: accountParam,
  },
  async ({ doc_id, match, match_all, font_family, font_size, text_color, bg_color, bold, italic, underline, strikethrough, alignment, line_spacing, account }) => {
    const args = ["docs", "format", doc_id];
    if (match) args.push("--match", match);
    if (match_all) args.push("--match-all");
    if (font_family) args.push("--font-family", font_family);
    if (font_size) args.push("--font-size", String(font_size));
    if (text_color) args.push("--text-color", text_color);
    if (bg_color) args.push("--bg-color", bg_color);
    if (bold) args.push("--bold");
    if (italic) args.push("--italic");
    if (underline) args.push("--underline");
    if (strikethrough) args.push("--strikethrough");
    if (alignment) args.push("--alignment", alignment);
    if (line_spacing) args.push("--line-spacing", String(line_spacing));
    return text(await runGog(args, account));
  }
);

// ========== DOCS INSERT & FIND-REPLACE ==========

server.tool(
  "docs_insert",
  "Insert text at a specific position in a Google Doc. Index 1 = beginning of document. Note: this inserts plain text only — for images, use docs_find_replace with format=markdown.",
  {
    doc_id: z.string().describe("Google Doc ID"),
    content: z.string().describe("Text to insert (plain text only)"),
    index: z.number().optional().default(1).describe("Character index to insert at (1 = beginning)"),
    tab_id: z.string().optional().describe("Target a specific tab by ID"),
    account: accountParam,
  },
  async ({ doc_id, content, index, tab_id, account }) => {
    const args = ["docs", "insert", doc_id, content, "--index", String(index)];
    if (tab_id) args.push("--tab-id", tab_id);
    return text(await runGog(args, account));
  }
);

server.tool(
  "docs_find_replace",
  "Find and replace text in a Google Doc. With format=markdown, supports rich replacements including inline images via ![alt](https://url){width=W height=H} syntax. This is the primary tool for inserting images into existing docs. Images must use remote URLs (http/https).",
  {
    doc_id: z.string().describe("Google Doc ID"),
    find: z.string().describe("Text to find"),
    replace: z.string().describe("Replacement text. With format=markdown: supports formatting, tables, and inline images via ![alt](https://url){width=300}. Images must be remote URLs."),
    format: z.enum(["plain", "markdown"]).optional().default("plain").describe("Replacement format: plain or markdown (markdown supports formatting, tables, inline images)"),
    match_case: z.boolean().optional().describe("Case-sensitive matching"),
    first_only: z.boolean().optional().describe("Replace only the first occurrence instead of all"),
    tab_id: z.string().optional().describe("Target a specific tab by ID"),
    account: accountParam,
  },
  async ({ doc_id, find, replace, format, match_case, first_only, tab_id, account }) => {
    const args = ["docs", "find-replace", doc_id, find, replace];
    if (format && format !== "plain") args.push("--format", format);
    if (match_case) args.push("--match-case");
    if (first_only) args.push("--first");
    if (tab_id) args.push("--tab-id", tab_id);
    return text(await runGog(args, account));
  }
);

// ========== DOCS SED ==========

server.tool(
  "docs_sed",
  `Powerful sed-like find/replace and formatting engine for Google Docs (SEDMAT syntax).
Supports regex, rich formatting, tables, lists, headings, page breaks, and more — all in a single command.

SYNTAX: s/pattern/replacement{flags}/g
  - pattern: literal text or regex
  - replacement: text with optional {flags} brace expressions
  - g flag: replace all occurrences (default: first only)

BRACE FLAGS (apply to replacement text):
  Text style: {b}=bold, {i}=italic, {_}=underline, {~}=strikethrough, {sc}=small caps, {^}=superscript, {v}=subscript
  Font/color: {f=Arial}, {s=14}, {c=#FF0000}, {z=#FFFF00} (bg), {o=50} (opacity)
  Paragraph: {h=1..6}=heading, {a=center}, {p=12,6}=spacing above/below, {l=1.5}=line spacing, {n=2}=indent
  Structure: {+=p}=page break, {+=s}=section break, {cols=2}=columns, {check}=checkbox
  Links: [text](url) in replacement
  Lists: - bullet item, 1. numbered item (with tab nesting)
  Images: ![alt](url){x=200,y=150}
  Tables: T=3x4 (create), |1| (target table 1)
  Reset: {0}=reset all formatting, {!0}=additive mode (preserve existing)
  Inline: {b=Warning}=bold just "Warning"

COMMANDS: s/find/replace/ (substitute), d/pattern/ (delete matching lines)
ADDRESS: 3s/old/new/ (line 3 only), $s/old/new/ (last line)
MULTIPLE: Use expressions array for multiple operations in one call.

EXAMPLES:
  s/Title/Title{h=1,f=Georgia,s=24,c=#1a1a1a}/
  s/Warning/Warning{b,c=#FF0000}/g
  s/$/\\n- Item 1\\n- Item 2/
  d/DELETE THIS LINE/`,
  {
    doc_id: z.string().describe("Google Doc ID"),
    expression: z.string().optional().describe("Single sed expression (e.g. s/old/new{b,c=#FF0000}/g)"),
    expressions: z.array(z.string()).optional().describe("Multiple sed expressions to apply in sequence"),
    dry_run: z.boolean().optional().describe("Preview changes without applying them"),
    tab: z.string().optional().describe("Target a specific tab by title or ID"),
    account: accountParam,
  },
  async ({ doc_id, expression, expressions, dry_run, tab, account }) => {
    const args = ["docs", "sed", doc_id];
    if (expression) args.push(expression);
    if (expressions) {
      for (const expr of expressions) {
        args.push("-e", expr);
      }
    }
    if (dry_run) args.push("--dry-run");
    if (tab) args.push("--tab", tab);
    return text(await runGog(args, account));
  }
);

// ========== DOCS COMMENTS ==========

server.tool(
  "docs_comments_list",
  "List comments on a Google Doc. Returns open comments by default.",
  {
    doc_id: z.string().describe("Google Doc ID"),
    include_resolved: z.boolean().optional().describe("Include resolved comments (default: open only)"),
    show_anchors: z.boolean().optional().describe("Include anchor data (kix IDs) for discovering anchor positions from UI-created comments"),
    max: z.number().optional().describe("Max results per page (default 100)"),
    page: z.string().optional().describe("Page token for pagination"),
    all: z.boolean().optional().describe("Fetch all pages"),
    account: accountParam,
  },
  async ({ doc_id, include_resolved, show_anchors, max, page, all, account }) => {
    const args = ["docs", "comments", "list", doc_id];
    if (include_resolved) args.push("--include-resolved");
    if (show_anchors) args.push("--show-anchors");
    if (max) args.push("--max", String(max));
    if (page) args.push("--page", page);
    if (all) args.push("--all");
    return text(await runGog(args, account));
  }
);

server.tool(
  "docs_comments_get",
  "Get a specific comment by ID from a Google Doc",
  {
    doc_id: z.string().describe("Google Doc ID"),
    comment_id: z.string().describe("Comment ID"),
    account: accountParam,
  },
  async ({ doc_id, comment_id, account }) =>
    text(await runGog(["docs", "comments", "get", doc_id, comment_id], account))
);

server.tool(
  "docs_comments_add",
  "Add a comment to a Google Doc. Note: comments cannot be anchored to specific text positions due to a Google API limitation — they appear as document-level comments.",
  {
    doc_id: z.string().describe("Google Doc ID"),
    content: z.string().describe("Comment text"),
    quoted: z.string().optional().describe("Quoted text metadata (does not anchor the comment due to Google API limitation)"),
    account: accountParam,
  },
  async ({ doc_id, content, quoted, account }) => {
    const args = ["docs", "comments", "add", doc_id, content];
    if (quoted) args.push("--quoted", quoted);
    return text(await runGog(args, account));
  }
);

server.tool(
  "docs_comments_reply",
  "Reply to a comment on a Google Doc",
  {
    doc_id: z.string().describe("Google Doc ID"),
    comment_id: z.string().describe("Comment ID to reply to"),
    content: z.string().describe("Reply text"),
    account: accountParam,
  },
  async ({ doc_id, comment_id, content, account }) =>
    text(await runGog(["docs", "comments", "reply", doc_id, comment_id, content], account))
);

server.tool(
  "docs_comments_resolve",
  "Resolve a comment (mark as done) on a Google Doc",
  {
    doc_id: z.string().describe("Google Doc ID"),
    comment_id: z.string().describe("Comment ID to resolve"),
    message: z.string().optional().describe("Optional message to include when resolving"),
    account: accountParam,
  },
  async ({ doc_id, comment_id, message, account }) => {
    const args = ["docs", "comments", "resolve", doc_id, comment_id];
    if (message) args.push("--message", message);
    return text(await runGog(args, account));
  }
);

server.tool(
  "docs_comments_delete",
  "Delete a comment from a Google Doc",
  {
    doc_id: z.string().describe("Google Doc ID"),
    comment_id: z.string().describe("Comment ID to delete"),
    account: accountParam,
  },
  async ({ doc_id, comment_id, account }) =>
    text(await runGog(["docs", "comments", "delete", doc_id, comment_id], account))
);

// ========== SHEETS ==========

server.tool(
  "sheets_get",
  "Read a range of cells from a Google Sheet",
  {
    sheet_id: z.string().describe("Google Sheet ID"),
    range: z.string().describe('Cell range (e.g. "Sheet1!A1:D10")'),
    account: accountParam,
  },
  async ({ sheet_id, range, account }) =>
    text(await runGog(["sheets", "get", sheet_id, range], account))
);

server.tool(
  "sheets_update",
  "Write values to a range in a Google Sheet",
  {
    sheet_id: z.string().describe("Google Sheet ID"),
    range: z.string().describe('Cell range (e.g. "Sheet1!A1:B2")'),
    values_json: z.string().describe('JSON array of arrays (e.g. \'[["A","B"],["1","2"]]\')'),
    input: z.string().optional().default("USER_ENTERED").describe("Value input option: USER_ENTERED or RAW"),
    account: accountParam,
  },
  async ({ sheet_id, range, values_json, input, account }) =>
    text(
      await runGog(
        ["sheets", "update", sheet_id, range, "--values-json", values_json, "--input", input],
        account
      )
    )
);

server.tool(
  "sheets_append",
  "Append rows to a Google Sheet",
  {
    sheet_id: z.string().describe("Google Sheet ID"),
    range: z.string().describe('Range to append to (e.g. "Sheet1!A:C")'),
    values_json: z.string().describe('JSON array of arrays to append'),
    account: accountParam,
  },
  async ({ sheet_id, range, values_json, account }) =>
    text(
      await runGog(
        ["sheets", "append", sheet_id, range, "--values-json", values_json, "--insert", "INSERT_ROWS"],
        account
      )
    )
);

// ========== CONTACTS ==========

server.tool(
  "contacts_list",
  "List contacts from Google Contacts",
  {
    max: z.number().optional().default(20).describe("Maximum contacts to return"),
    account: accountParam,
  },
  async ({ max, account }) =>
    text(await runGog(["contacts", "list", "--max", String(max)], account))
);

// ---------- Start ----------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`gog-mcp fatal: ${err}\n`);
  process.exit(1);
});
