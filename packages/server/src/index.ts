import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(dirname, "../../app/dist");
const port = Number(process.env.PORT ?? 8080);

const app = express();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.use(express.static(distDir));

app.use((_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  console.log(`apple-ii serving ${distDir}`);
  console.log(`http://localhost:${port} (health: /healthz)`);
});
