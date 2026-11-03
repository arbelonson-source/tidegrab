// Copies README.md into public/ and renders it into a static /docs page,
// so the docs read fine without JavaScript (curl, screen readers, crawlers).
import fs from "node:fs";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, (_, c) => "<code>" + c.replace(/\\\|/g, "|") + "</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https:\/\/[^\s)<]+)/g, '$1<a href="$2">$2</a>');
const cells = (line) => line.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());

export function render(md) {
  const out = [];
  let list = false, code = null, para = [], table = null;
  const flushPara = () => { if (para.length) out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; };
  const closeList = () => { if (list) out.push("</ul>"); list = false; };
  const closeTable = () => { if (table) out.push("</tbody></table></div>"); table = null; };
  const flush = () => { flushPara(); closeList(); closeTable(); };
  for (const line of md.split("\n")) {
    if (code !== null) {
      if (line.startsWith("```")) { out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); code = null; } else code.push(line);
      continue;
    }
    if (line.startsWith("```")) { flush(); code = []; continue; }
    if (line.startsWith("|")) {
      if (/^\|[-| :]+\|$/.test(line)) continue;
      if (!table) {
        flushPara(); closeList();
        out.push('<div class="tablewrap"><table><thead><tr>' + cells(line).map((c) => `<th scope="col">${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
        table = true;
      } else out.push("<tr>" + cells(line).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      continue;
    }
    closeTable();
    const h = /^(#{1,4}) (.*)/.exec(line);
    if (h) { flush(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const li = /^[-*] (.*)/.exec(line);
    if (li) { flushPara(); if (!list) out.push("<ul>"); list = true; out.push("<li>" + inline(li[1]) + "</li>"); continue; }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    para.push(line.trim());
  }
  flush();
  return out.join("\n");
}

const md = fs.readFileSync("README.md", "utf8");
fs.writeFileSync("public/README.md", md);
fs.writeFileSync("public/docs.html", `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tidegrab API docs</title>
<meta name="description" content="Rules and HTTP/JSON agent API for Tidegrab, a secret-bid diving game.">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top"><a class="brand" href="/"><span>Tidegrab</span></a><nav><a href="/">Play</a> <a href="/README.md">Markdown</a> <a href="/api/rules">Rules JSON</a></nav></header>
<main class="docs" id="doc">
${render(md)}
</main>
</body>
</html>
`);
