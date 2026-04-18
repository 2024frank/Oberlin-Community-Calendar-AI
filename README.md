# Community Civic Feed: AI-Powered Event Aggregator

This project is an AI-assisted system designed to unify distributed event information into a shared civic resource for the Oberlin community. It interprets unstructured and semi-structured information from various local organizations, extracts structured data, and proposes standardized entries for human vetting.

## Core Innovation

Traditional web scraping fails when faced with heterogeneous data sources. This platform uses Large Language Models (LLMs) to:
- **Interpret variation** in language, layout, and structure across diverse websites.
- **Normalize metadata** into a standardized research-grade format.
- **Identify geographic scope** (Hyperlocal to Regional) automatically.
- **Provide real-time meta-analysis** via the "AI Community Pulse".

## System Architecture

### Frontend
- **React 19 + Vite**: Modern, high-performance UI.
- **Tailwind CSS + Lucide**: Sleek, accessible design.
- **Motion (Framer Motion)**: Fluid transitions and UI states.
- **Recharts**: Data visualization for extraction accuracy and source distribution.

### AI Agents
- **Extraction Agent (OpenAI GPT-4o)**: Orchestrates the transformation of raw text into structured JSON-LD payloads.
- **Community Pulse Agent (Gemini)**: Analyzes the "vibe" of the community based on current events.
- **Research Insight Agent**: Monitors system performance and provides automated recommendations for data quality improvement.

### Data Sources
The system monitors public event information from:
- Oberlin College and Conservatory
- Heritage Society
- Allen Memorial Art Museum (AMAM)
- City of Oberlin
- FAVA (Firelands Association for the Visual Arts)
- Apollo Theatre
- Oberlin Business Partnership
- Oberlin Public Library

## Key Features

- **Real-time Polling**: Configurable background sync for each data source.
- **Robust Duplicate Detection**: Multi-layered check using both unique external IDs and semantic content hashing.
- **Precision Audit**: Automated scoring of event quality (0-100%) based on metadata completeness.
- **Human-in-the-loop**: Full editing and approval workflow for research verification.

## Getting Started

1. **Environment Setup**:
   Copy `.env.example` to `.env` and provide your API keys:
   ```env
   OPENAI_API_KEY=your_key_here
   GEMINI_API_KEY=your_key_here
   ```

2. **Installation**:
   ```bash
   npm install
   ```

3. **Development**:
   ```bash
   npm run dev
   ```

## Precision Metrics
Extraction accuracy is calculated in real-time as:
`Accuracy = Approved Records / (Approved Records + Rejected Records)`

This ensures that the "Precision Audit" reflects the true performance of the AI extraction model against human verification standards.
