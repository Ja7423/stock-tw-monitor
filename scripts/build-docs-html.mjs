// 把 Markdown 文件嵌入 scripts/docs-template.html，產生可互動的 doc/html/index.html
// 用法：npm run docs:html（修改任何一份 Markdown 文件後都要重跑）
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOCS = [
  { key: "overview", title: "專案總覽", file: "README.md" },
  { key: "usage", title: "Bot 使用教學", file: "doc/bot-usage.md" },
  { key: "metrics", title: "報告數值說明", file: "doc/report-metrics.md" },
  { key: "architecture", title: "專案架構", file: "doc/architecture.md" },
];

const docs = DOCS.map((d) => ({ ...d, md: readFileSync(join(root, d.file), "utf8") }));

// 嵌進 <script> 時避免 </script> 提早結束標籤，以及 JS 字串不接受的行分隔字元
const json = JSON.stringify(docs)
  .replaceAll("<", "\\u003c")
  .replaceAll(String.fromCharCode(0x2028), "\\u2028")
  .replaceAll(String.fromCharCode(0x2029), "\\u2029");

const template = readFileSync(join(root, "scripts/docs-template.html"), "utf8");
if (!template.includes("__DOCS_JSON__")) throw new Error("模板缺少 __DOCS_JSON__ 佔位符");

const outDir = join(root, "doc/html");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), template.replace("__DOCS_JSON__", () => json));
console.log(`已產生 doc/html/index.html（${docs.length} 份文件）`);
