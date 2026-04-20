import express from "express";
import dotenv from "dotenv";
import { attachResearchApi, setupCors } from "./researchApi.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

setupCors(app);
attachResearchApi(app);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Research API (API-only) on http://0.0.0.0:${PORT}`);
  console.log(`Health: GET /health`);
});
