const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

function render(md) {
  const out = [];
  let list = false, code = null, para = [];
  const flushPara = () => { if (para.length) out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; };
  const closeList = () => { if (list) out.push("</ul>"); list = false; };
  for (const line of md.split("\n")) {
    if (code !== null) {
      if (line.startsWith("```")) { out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); code = null; } else code.push(line);
      continue;
    }
    if (line.startsWith("```")) { flushPara(); closeList(); code = []; continue; }
    const h = /^(#{1,4}) (.*)/.exec(line);
    if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const li = /^[-*] (.*)/.exec(line);
    if (li) { flushPara(); if (!list) out.push("<ul>"); list = true; out.push("<li>" + inline(li[1]) + "</li>"); continue; }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    para.push(line.trim());
  }
  flushPara(); closeList();
  return out.join("\n");
}

try {
  const r = await fetch("/README.md");
  if (!r.ok) throw new Error();
  document.getElementById("doc").innerHTML = render(await r.text());
} catch {
  document.getElementById("doc").innerHTML = "<p>Docs are unavailable. See <a href=\"/api/rules\">/api/rules</a>.</p>";
}
