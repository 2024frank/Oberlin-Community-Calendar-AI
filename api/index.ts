import express from "express";
import dotenv from "dotenv";
import { attachResearchApi, setupCors } from "../researchApi.js";

dotenv.config();

const app = express();
setupCors(app);
attachResearchApi(app);

export default app;
